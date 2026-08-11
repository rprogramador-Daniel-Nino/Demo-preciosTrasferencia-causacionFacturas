<?php
// api/fallback-gemini.php — Cuando Anthropic no puede atender, atiende Gemini.
//
// Port a mano de functions/fallbackGemini.js. Las dos implementaciones de JavaScript
// —server.js y functions/index.js— comparten ese archivo; esta es otra lengua y no puede,
// así que al cambiar una hay que cambiar la otra. Las pruebas de la lógica están en
// functions/fallbackGemini.test.js.
//
// POR QUÉ LA RESPUESTA SE DEVUELVE CON FORMA DE ANTHROPIC: los llamadores leen
// `data.content[].text`. Devolver la forma de Gemini les daría una respuesta vacía SIN
// error, y el informe saldría sin la redacción sin que nadie se entere.

define('PROVEEDOR_GEMINI', 'gemini');
define('CABECERA_PROVEEDOR', 'X-Proveedor-IA');
define('GEMINI_MODEL_FALLBACK', 'gemini-3.5-flash');

/**
 * ¿Hay que reintentar esta respuesta de Anthropic contra Gemini?
 *
 * Solo cuando Anthropic no puede atender algo que sí está bien pedido: sin saldo, con el tope
 * de gasto de la cuenta alcanzado, con el límite de peticiones alcanzado o sobrecargado. Un
 * 400 por petición mal formada o un 401 por key inválida fallarían igual en Gemini, y caer
 * ahí enmascara un defecto propio.
 */
function debeCaerAGemini($status, $cuerpo) {
    if ($status === 429 || $status === 529) {
        return true;
    }
    if ($status === 400 || $status === 402) {
        // Se compara sobre el mensaje porque el `type` es el genérico
        // `invalid_request_error`, el mismo de una petición mal formada.
        // El segundo patrón es el tope de gasto que la propia organización fijó en la
        // consola («You have reached your specified API usage limits»): mismo 400 y mismo
        // type que el crédito agotado, pero sin nombrar el saldo.
        $mensaje = $cuerpo['error']['message'] ?? ($cuerpo['message'] ?? '');
        return (bool) preg_match('/credit balance|insufficient.*credit|billing/i', (string) $mensaje)
            || (bool) preg_match('/usage limits?|spend limits?/i', (string) $mensaje);
    }
    return false;
}

/** El texto de un `content` de Anthropic, que puede ser cadena o arreglo de bloques. */
function textoDeContenidoAnthropic($contenido) {
    if (is_string($contenido)) {
        return $contenido;
    }
    if (!is_array($contenido)) {
        return '';
    }
    $texto = '';
    foreach ($contenido as $bloque) {
        if (is_string($bloque)) {
            $texto .= $bloque;
        } elseif (is_array($bloque) && isset($bloque['text'])) {
            $texto .= $bloque['text'];
        }
    }
    return $texto;
}

/**
 * Traduce una petición de la API Messages de Anthropic a una de Gemini.
 * El modelo no viaja en el cuerpo: en Gemini va en la URL.
 */
function aPeticionGemini($cuerpo) {
    $contents = [];
    foreach (($cuerpo['messages'] ?? []) as $m) {
        $contents[] = [
            // Gemini llama «model» a lo que Anthropic llama «assistant».
            'role'  => (($m['role'] ?? '') === 'assistant') ? 'model' : 'user',
            'parts' => [['text' => textoDeContenidoAnthropic($m['content'] ?? '')]],
        ];
    }

    $salida = ['contents' => $contents];

    // El pensamiento de Gemini se desactiva porque `max_tokens` de Anthropic cuenta solo el
    // texto, y `maxOutputTokens` de Gemini cuenta también el razonamiento: traducirlo 1:1 con
    // el pensamiento activo devuelve el párrafo cortado a media frase. Ver el detalle medido
    // en functions/fallbackGemini.js.
    $generationConfig = ['thinkingConfig' => ['thinkingBudget' => 0]];
    if (isset($cuerpo['max_tokens'])) {
        $generationConfig['maxOutputTokens'] = $cuerpo['max_tokens'];
    }
    if (isset($cuerpo['temperature'])) {
        $generationConfig['temperature'] = $cuerpo['temperature'];
    }
    $salida['generationConfig'] = $generationConfig;

    $system = textoDeContenidoAnthropic($cuerpo['system'] ?? '');
    if ($system !== '') {
        $salida['systemInstruction'] = ['parts' => [['text' => $system]]];
    }

    return $salida;
}

/**
 * Traduce la respuesta de Gemini a la forma de la API Messages de Anthropic.
 * Devuelve null si Gemini no dio texto —un bloqueo por filtros deja `candidates` vacío—:
 * devolver «» haría pasar un silencio por una respuesta.
 */
function aRespuestaAnthropic($datos, $modelo) {
    $partes = $datos['candidates'][0]['content']['parts'] ?? [];
    $texto = '';
    foreach ($partes as $p) {
        $texto .= $p['text'] ?? '';
    }
    if (trim($texto) === '') {
        return null;
    }

    $stopReason = [
        'STOP'       => 'end_turn',
        'MAX_TOKENS' => 'max_tokens',
        'SAFETY'     => 'stop_sequence',
        'RECITATION' => 'stop_sequence',
    ];
    $fin = $datos['candidates'][0]['finishReason'] ?? '';

    return [
        'id'            => 'msg_fallback_gemini',
        'type'          => 'message',
        'role'          => 'assistant',
        'model'         => $modelo,
        'content'       => [['type' => 'text', 'text' => $texto]],
        'stop_reason'   => $stopReason[$fin] ?? 'end_turn',
        'stop_sequence' => null,
        'usage'         => [
            'input_tokens'  => $datos['usageMetadata']['promptTokenCount'] ?? 0,
            'output_tokens' => $datos['usageMetadata']['candidatesTokenCount'] ?? 0,
        ],
        // Fuera del contrato de Anthropic a propósito: quien lo mire sabe que esto no lo
        // redactó Claude.
        'proveedor'     => PROVEEDOR_GEMINI,
    ];
}

/**
 * Atiende con Gemini una petición que venía para Claude.
 *
 * @return array|null la respuesta traducida, o null si Gemini tampoco pudo. En ese caso
 *         quien llama devuelve el error ORIGINAL de Anthropic: es el que explica por qué se
 *         llegó hasta aquí, y taparlo con un fallo de Gemini manda a depurar al proveedor
 *         equivocado.
 */
function atenderConGemini($cuerpoOriginal, $config, $statusAnthropic) {
    $geminiKey = getenv('GEMINI_API_KEY') ?: ($config['GEMINI_API_KEY'] ?? null);
    if (!$geminiKey) {
        error_log('Claude no pudo atender y no hay GEMINI_API_KEY para el fallback.');
        return null;
    }

    error_log('[fallback] Claude no pudo atender (HTTP ' . $statusAnthropic . '); se atiende con '
        . GEMINI_MODEL_FALLBACK . '.');

    $url = 'https://generativelanguage.googleapis.com/v1beta/models/'
        . GEMINI_MODEL_FALLBACK . ':generateContent';

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(aPeticionGemini($cuerpoOriginal)));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-goog-api-key: ' . trim($geminiKey),
    ]);
    $respuesta = curl_exec($ch);
    $codigo = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $errorCurl = curl_errno($ch) ? curl_error($ch) : null;
    curl_close($ch);

    if ($errorCurl !== null) {
        error_log('Error llamando a Gemini como fallback de Claude: ' . $errorCurl);
        return null;
    }
    if ($codigo < 200 || $codigo >= 300) {
        error_log('El fallback a Gemini respondió HTTP ' . $codigo . ': ' . $respuesta);
        return null;
    }

    $traducida = aRespuestaAnthropic(json_decode($respuesta, true) ?: [], GEMINI_MODEL_FALLBACK);
    if ($traducida === null) {
        error_log('El fallback a Gemini tampoco devolvió texto: ' . $respuesta);
    }
    return $traducida;
}
