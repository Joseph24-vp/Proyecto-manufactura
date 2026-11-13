<?php
// Diagnóstico local de instalación (no cambia datos).
$config = require __DIR__ . '/config.php';
$checks = [];
$ok = false;
if (!extension_loaded('pdo_mysql')) {
    $checks[] = ['PHP y MySQL', false, 'La extensión PDO MySQL de PHP no está habilitada. En XAMPP active pdo_mysql en php.ini.'];
} else {
    try {
        $pdo = new PDO('mysql:host=' . $config['host'] . ';port=' . $config['port'] . ';dbname=' . $config['dbname'] . ';charset=utf8mb4', $config['user'], $config['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $checks[] = ['Servidor MySQL', true, 'Conexión establecida correctamente con la base ' . $config['dbname'] . '.'];
        $expected = ['PROVEEDOR', 'CLIENTE', 'ALMACEN', 'PRODUCTO', 'BOM', 'RUTA_PRODUCCION', 'LOTE', 'ORDEN_COMPRA', 'ORDEN_VENTA', 'ORDEN_PRODUCCION', 'MOVIMIENTO_INVENTARIO', 'INSPECCION_CALIDAD'];
        $actual = $pdo->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
        $missing = array_values(array_diff($expected, $actual));
        $ok = count($missing) === 0;
        $checks[] = ['Tablas del proyecto', $ok, $ok ? 'Encontradas las 12 tablas de ECOLIFT.' : 'Faltan: ' . implode(', ', $missing) . '. Importe database/schema_mysql_ecolift.sql desde phpMyAdmin.'];
        if ($ok) {
            $count = (int)$pdo->query('SELECT COUNT(*) FROM PRODUCTO')->fetchColumn();
            $checks[] = ['Catálogo', $count > 0, $count . ' productos e insumos registrados en MySQL.'];
            $ok = $count > 0;
        }
    } catch (Throwable $e) {
        $checks[] = ['Servidor MySQL', false, $e->getMessage()];
    }
}
function safe($x) { return htmlspecialchars((string)$x, ENT_QUOTES, 'UTF-8'); }
?><!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ECOLIFT · Verificación MySQL</title><style>
body{background:#edf5f5;font:15px/1.6 system-ui,Arial,sans-serif;color:#13263e;margin:0;padding:26px}.wrap{max-width:670px;margin:40px auto;background:#fff;border-radius:18px;padding:30px;box-shadow:0 15px 42px #113b3520}h1{font-size:25px;margin:0}.muted{color:#64748b}.status{font-weight:800;color:<?= $ok?'#047857':'#b91c1c' ?>;font-size:18px;margin-top:8px}.item{display:flex;gap:12px;align-items:start;border-top:1px solid #e2e8f0;padding:17px 0}.check{padding:4px 8px;border-radius:7px;background:#edf8f2;color:#047857;font-weight:800}.fail{background:#fff1f2;color:#be123c}a{display:inline-block;background:#059669;color:white;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:700}.small{font-size:12px}
</style></head><body><div class="wrap"><h1>ECOLIFT ERP / MES</h1><div class="muted">Diagnóstico de conexión con MySQL · XAMPP</div><p class="status"><?= $ok?'✓ Instalación preparada':'⚠ Hay algo por configurar' ?></p>
<?php foreach ($checks as [$name,$pass,$detail]): ?><div class="item"><span class="check <?= $pass?'':'fail' ?>"><?= $pass?'OK':'ERROR' ?></span><div><strong><?= safe($name) ?></strong><div class="muted"><?= safe($detail) ?></div></div></div><?php endforeach; ?>
<p class="small muted">Si falla el acceso, revise Apache y MySQL en XAMPP, e inspeccione las credenciales de <strong>config.php</strong>.</p><a href="index.html">Volver al sistema</a></div></body></html>
