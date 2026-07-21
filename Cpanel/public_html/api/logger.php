<?php
// api/logger.php — Helper para registro y control de consumo de Tokens de Claude

function getUsageFile() {
    return __DIR__ . '/usage_data.json';
}

function loadUsageData() {
    $file = getUsageFile();
    if (file_exists($file)) {
        $content = file_get_contents($file);
        $data = json_decode($content, true);
        if (is_array($data)) {
            return $data;
        }
    }
    return [
        'total_input_tokens' => 0,
        'total_output_tokens' => 0,
        'daily_usage' => [],
        'history' => []
    ];
}

function saveUsageData($data) {
    $file = getUsageFile();
    // Guardar con formateo legible
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));
}

function checkDailyLimit($config) {
    $maxDaily = $config['MAX_DAILY_TOKENS'] ?? 0; // 0 significa sin límite
    if ($maxDaily <= 0) return true;

    $today = date('Y-m-d');
    $data = loadUsageData();
    $todayUsage = $data['daily_usage'][$today]['total_tokens'] ?? 0;

    return $todayUsage < $maxDaily;
}

function logClaudeUsage($appName, $inputTokens, $outputTokens, $model = 'claude-3-5-sonnet-20241022') {
    $data = loadUsageData();
    $today = date('Y-m-d');
    $now = date('Y-m-d H:i:s');

    $inputTokens = max(0, (int)$inputTokens);
    $outputTokens = max(0, (int)$outputTokens);
    $totalTokens = $inputTokens + $outputTokens;

    // Calcular costo estimado aproximado (USD)
    // Precios aprox Sonnet 3.5: $3.00 / M input, $15.00 / M output
    $estCost = ($inputTokens * 0.000003) + ($outputTokens * 0.000015);

    // 1. Acumulados totales
    $data['total_input_tokens'] = ($data['total_input_tokens'] ?? 0) + $inputTokens;
    $data['total_output_tokens'] = ($data['total_output_tokens'] ?? 0) + $outputTokens;

    // 2. Acumulados por día
    if (!isset($data['daily_usage'][$today])) {
        $data['daily_usage'][$today] = [
            'input_tokens' => 0,
            'output_tokens' => 0,
            'total_tokens' => 0,
            'est_cost' => 0,
            'requests' => 0
        ];
    }

    $data['daily_usage'][$today]['input_tokens'] += $inputTokens;
    $data['daily_usage'][$today]['output_tokens'] += $outputTokens;
    $data['daily_usage'][$today]['total_tokens'] += $totalTokens;
    $data['daily_usage'][$today]['est_cost'] += $estCost;
    $data['daily_usage'][$today]['requests'] += 1;

    // 3. Historial de solicitudes (últimas 100)
    if (!isset($data['history'])) {
        $data['history'] = [];
    }

    array_unshift($data['history'], [
        'fecha' => $now,
        'app' => $appName,
        'model' => $model,
        'input_tokens' => $inputTokens,
        'output_tokens' => $outputTokens,
        'total_tokens' => $totalTokens,
        'est_cost' => round($estCost, 4)
    ]);

    // Mantener solo las últimas 100 peticiones en el historial
    $data['history'] = array_slice($data['history'], 0, 100);

    saveUsageData($data);
}
