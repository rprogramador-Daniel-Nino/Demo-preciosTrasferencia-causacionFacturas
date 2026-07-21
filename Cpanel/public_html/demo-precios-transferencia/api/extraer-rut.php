<?php
// api/extraer-rut.php — Proxy PHP para extracción de datos de RUT usando Claude API con control de Tokens
header('Content-Type: application/json');
require_once __DIR__ . '/logger.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

$config = file_exists(__DIR__ . '/config.php') ? (require __DIR__ . '/config.php') : [];
$apiKey = getenv('ANTHROPIC_API_KEY') ?: ($config['ANTHROPIC_API_KEY'] ?? null);

if (!$apiKey || empty($apiKey)) {
    http_response_code(500);
    echo json_encode(['error' => 'Servidor sin ANTHROPIC_API_KEY configurada.']);
    exit;
}

if (!checkDailyLimit($config)) {
    http_response_code(429);
    echo json_encode(['error' => 'Límite diario de consumo de tokens alcanzado. Intenta de nuevo mañana.']);
    exit;
}

$rawInput = file_get_contents('php://input');
$body = json_decode($rawInput, true);

$b64 = $body['archivo_base64'] ?? '';
$mime = $body['tipo'] ?? 'application/pdf';

if (empty($b64)) {
    http_response_code(400);
    echo json_encode(['error' => 'Falta el archivo_base64 en la solicitud.']);
    exit;
}

// Determinar el bloque según si es PDF o imagen
$contentBlock = [];
if (strpos($mime, 'pdf') !== false) {
    $contentBlock = [
        'type' => 'document',
        'source' => [
            'type' => 'base64',
            'media_type' => 'application/pdf',
            'data' => $b64
        ]
    ];
} else {
    $mediaType = strpos($mime, 'png') !== false ? 'image/png' : 'image/jpeg';
    $contentBlock = [
        'type' => 'image',
        'source' => [
            'type' => 'base64',
            'media_type' => $mediaType,
            'data' => $b64
        ]
    ];
}

$promptText = "Extrae la información de este RUT colombiano (DIAN) en formato JSON estricto con las siguientes llaves:\n"
    . "- nit: string con dígito de verificación (ejemplo: '900123456-7')\n"
    . "- razon_social: string con la razón social o nombre completo\n"
    . "- municipio: string con la ciudad o municipio principal de la dirección (ej: 'BOGOTA D.C.', 'MEDELLIN')\n"
    . "- direccion: string con la dirección física\n"
    . "- responsabilidades: array de strings con los códigos numéricos de casillas 53/54 (ej: ['05', '09', '14', '48'])\n"
    . "- confianza: número de 0 a 100 indicando legibilidad\n\n"
    . "Responde ÚNICAMENTE con el objeto JSON válido sin marcas de markdown ```json ni texto adicional.";

$payload = [
    'model' => 'claude-3-5-sonnet-20241022',
    'max_tokens' => 1024,
    'messages' => [
        [
            'role' => 'user',
            'content' => [
                $contentBlock,
                ['type' => 'text', 'text' => $promptText]
            ]
        ]
    ]
];

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
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

$responseData = json_decode($response, true);

if ($httpCode >= 200 && $httpCode < 300 && isset($responseData['content'][0]['text'])) {
    if (isset($responseData['usage'])) {
        $inTokens = $responseData['usage']['input_tokens'] ?? 0;
        $outTokens = $responseData['usage']['output_tokens'] ?? 0;
        logClaudeUsage('Causación Facturas (RUT)', $inTokens, $outTokens, 'claude-3-5-sonnet-20241022');
    }

    $text = trim($responseData['content'][0]['text']);
    $text = preg_replace('/^```(?:json)?\s*/i', '', $text);
    $text = preg_replace('/\s*```$/', '', $text);
    $rutData = json_decode($text, true);

    if ($rutData && is_array($rutData)) {
        http_response_code(200);
        echo json_encode($rutData);
        exit;
    }
}

// Si hubo error o la respuesta no vino en JSON esperado:
http_response_code($httpCode > 0 ? $httpCode : 500);
echo json_encode([
    'error' => 'No se pudo extraer la información del RUT.',
    'raw_response' => $responseData
]);
