<?php
// api/claude.php — Proxy PHP hacia la API de Anthropic con control de consumo de Tokens (cPanel)
header('Content-Type: application/json');
require_once __DIR__ . '/logger.php';
require_once __DIR__ . '/fallback-gemini.php';

// Permitir solicitudes solo mediante POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// 1. Cargar configuración
$config = file_exists(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$apiKey = getenv('ANTHROPIC_API_KEY') ?: ($config['ANTHROPIC_API_KEY'] ?? null);

if (!$apiKey || empty($apiKey)) {
    http_response_code(500);
    echo json_encode(['error' => 'Servidor sin ANTHROPIC_API_KEY configurada.']);
    exit;
}

// 2. Verificar límite diario si está configurado
if (!checkDailyLimit($config)) {
    http_response_code(429);
    echo json_encode(['error' => 'Límite diario de consumo de tokens alcanzado. Intenta de nuevo mañana.']);
    exit;
}

// 3. Leer la solicitud enviada por el frontend
$inputData = file_get_contents('php://input');

// 4. Reenviar la petición a Anthropic mediante cURL
$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $inputData);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'x-api-key: ' . trim($apiKey),
    'anthropic-version: 2023-06-01'
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);

if (curl_errno($ch)) {
    $errorMsg = curl_error($ch);
    curl_close($ch);
    http_response_code(502);
    echo json_encode(['error' => 'No se pudo contactar a la API de Claude.', 'detail' => $errorMsg]);
    exit;
}

curl_close($ch);

// 5. Si Claude no pudo atender —sin saldo, con el límite alcanzado o sobrecargado—, la
//    petición la atiende Gemini y la respuesta sale con forma de Anthropic, para que ningún
//    llamador note el cambio. El límite diario del punto 2 NO llega aquí: es control de
//    costo propio y sale antes, sin gastar en el otro proveedor.
$resData = json_decode($response, true) ?: [];
if (debeCaerAGemini($httpCode, $resData)) {
    $conGemini = atenderConGemini(json_decode($inputData, true) ?: [], $config, $httpCode);
    if ($conGemini !== null) {
        header(CABECERA_PROVEEDOR . ': ' . PROVEEDOR_GEMINI);
        http_response_code(200);
        echo json_encode($conGemini);
        exit;
    }
    // Gemini tampoco pudo: sigue el curso normal y se devuelve el error de Anthropic, que
    // es el que explica por qué se llegó hasta aquí.
}
header(CABECERA_PROVEEDOR . ': anthropic');

// 6. Registrar el consumo de tokens si la respuesta fue exitosa
if ($httpCode >= 200 && $httpCode < 300 && isset($resData['usage'])) {
    $inTokens = $resData['usage']['input_tokens'] ?? 0;
    $outTokens = $resData['usage']['output_tokens'] ?? 0;
    $model = $resData['model'] ?? 'claude-3-5-sonnet';
    logClaudeUsage('Precios de Transferencia', $inTokens, $outTokens, $model);
}

// 7. Devolver la respuesta de Anthropic al cliente
http_response_code($httpCode > 0 ? $httpCode : 200);
echo $response;
