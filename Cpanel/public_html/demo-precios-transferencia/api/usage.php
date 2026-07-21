<?php
// api/usage.php — Panel de control y monitoreo de Tokens de Claude
require_once __DIR__ . '/logger.php';

$data = loadUsageData();
$today = date('Y-m-d');
$todayData = $data['daily_usage'][$today] ?? [
    'input_tokens' => 0,
    'output_tokens' => 0,
    'total_tokens' => 0,
    'est_cost' => 0,
    'requests' => 0
];

$totalInput = $data['total_input_tokens'] ?? 0;
$totalOutput = $data['total_output_tokens'] ?? 0;
$totalTokens = $totalInput + $totalOutput;
$totalCost = ($totalInput * 0.000003) + ($totalOutput * 0.000015);
$history = $data['history'] ?? [];
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Monitoreo de Tokens — Claude API</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 font-sans p-4 md:p-8 min-h-screen">
    <div class="max-w-6xl mx-auto space-y-6">

        <!-- Encabezado -->
        <div class="flex flex-wrap justify-between items-center bg-slate-800/80 p-5 rounded-xl border border-slate-700">
            <div>
                <h1 class="text-2xl font-bold text-blue-400 flex items-center gap-2">
                    📊 Control de Consumo de Tokens
                </h1>
                <p class="text-xs text-slate-400 mt-1">Monitoreo en tiempo real de peticiones enviadas a Anthropic Claude</p>
            </div>
            <button onclick="location.reload()" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold shadow">
                🔄 Actualizar
            </button>
        </div>

        <!-- Tarjetas Metricas -->
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <!-- Hoy Tokens -->
            <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700 text-center">
                <span class="text-xs font-semibold text-slate-400 uppercase">Tokens Consumidos (Hoy)</span>
                <div class="text-2xl font-bold text-emerald-400 mt-2">
                    <?php echo number_format($todayData['total_tokens']); ?>
                </div>
                <span class="text-[11px] text-slate-400 mt-1 block">
                    <?php echo number_format($todayData['requests']); ?> peticiones hoy
                </span>
            </div>

            <!-- Hoy Costo -->
            <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700 text-center">
                <span class="text-xs font-semibold text-slate-400 uppercase">Costo Estimado (Hoy)</span>
                <div class="text-2xl font-bold text-cyan-400 mt-2">
                    $<?php echo number_format($todayData['est_cost'], 4); ?> USD
                </div>
                <span class="text-[11px] text-slate-400 mt-1 block">Entrada + Salida</span>
            </div>

            <!-- Total Tokens -->
            <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700 text-center">
                <span class="text-xs font-semibold text-slate-400 uppercase">Tokens Totales (Acumulado)</span>
                <div class="text-2xl font-bold text-purple-400 mt-2">
                    <?php echo number_format($totalTokens); ?>
                </div>
                <span class="text-[11px] text-slate-400 mt-1 block">
                    Entrada: <?php echo number_format($totalInput); ?> | Salida: <?php echo number_format($totalOutput); ?>
                </span>
            </div>

            <!-- Total Costo -->
            <div class="bg-slate-800/60 p-4 rounded-xl border border-slate-700 text-center">
                <span class="text-xs font-semibold text-slate-400 uppercase">Costo Acumulado Total</span>
                <div class="text-2xl font-bold text-amber-400 mt-2">
                    $<?php echo number_format($totalCost, 4); ?> USD
                </div>
                <span class="text-[11px] text-slate-400 mt-1 block">Total histórico</span>
            </div>
        </div>

        <!-- Tabla Historial -->
        <div class="bg-slate-800/80 rounded-xl p-5 border border-slate-700 space-y-4">
            <h2 class="text-base font-bold text-slate-200 flex items-center justify-between">
                <span>📜 Historial de Peticiones Recientes</span>
                <span class="text-xs font-normal text-slate-400">Últimas <?php echo count($history); ?> peticiones</span>
            </h2>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs text-slate-300">
                    <thead class="bg-slate-900/80 text-slate-400 uppercase text-[10px] border-b border-slate-700">
                        <tr>
                            <th class="p-3">Fecha / Hora</th>
                            <th class="p-3">Aplicación</th>
                            <th class="p-3">Modelo</th>
                            <th class="p-3 text-right">Input Tokens</th>
                            <th class="p-3 text-right">Output Tokens</th>
                            <th class="p-3 text-right">Total Tokens</th>
                            <th class="p-3 text-right">Costo Est. ($USD)</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-700/50">
                        <?php if (empty($history)): ?>
                            <tr>
                                <td colspan="7" class="text-center py-6 text-slate-500">
                                    No hay registros de consumo todavía.
                                </td>
                            </tr>
                        <?php else: ?>
                            <?php foreach ($history as $row): ?>
                                <tr class="hover:bg-slate-700/30">
                                    <td class="p-3 font-mono"><?php echo htmlspecialchars($row['fecha'] ?? '—'); ?></td>
                                    <td class="p-3 font-semibold text-blue-300"><?php echo htmlspecialchars($row['app'] ?? '—'); ?></td>
                                    <td class="p-3 text-slate-400 font-mono text-[11px]"><?php echo htmlspecialchars($row['model'] ?? '—'); ?></td>
                                    <td class="p-3 text-right font-mono text-emerald-400"><?php echo number_format($row['input_tokens'] ?? 0); ?></td>
                                    <td class="p-3 text-right font-mono text-cyan-400"><?php echo number_format($row['output_tokens'] ?? 0); ?></td>
                                    <td class="p-3 text-right font-mono font-bold text-slate-100"><?php echo number_format($row['total_tokens'] ?? 0); ?></td>
                                    <td class="p-3 text-right font-mono text-amber-400">$<?php echo number_format($row['est_cost'] ?? 0, 4); ?></td>
                                </tr>
                            <?php endforeach; ?>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>

    </div>
</body>
</html>
