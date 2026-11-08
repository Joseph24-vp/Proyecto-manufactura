<?php
/**
 * Backend Transaccional en PHP/PDO + MySQL para XAMPP
 * Sistema ECOLIFT ERP / MES / SCADA-IIoT (Estándar ANSI/ISA-95)
 *
 * Lee y guarda TODOS los datos directamente en la base de datos MySQL `ecolift_erp_mes`
 * (sin productos cableados en JavaScript). Si la base de datos aún no existe en XAMPP,
 * este mismo script la inicializa y puebla automáticamente en la primera petición.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$host = '127.0.0.1';
$port = '3306';
$dbname = 'ecolift_erp_mes';
$user = 'root';
$pass = '';

function getPdoConnection($host, $port, $dbname, $user, $pass) {
    $pdoRoot = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    $pdoRoot->exec("CREATE DATABASE IF NOT EXISTS `$dbname` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdoRoot->exec("USE `$dbname`");

    // Verificar si la tabla PRODUCTO ya existe; si no, ejecutar el esquema inicial desde database/schema_mysql_ecolift.sql
    $stmt = $pdoRoot->query("SHOW TABLES LIKE 'PRODUCTO'");
    if ($stmt->rowCount() === 0) {
        $sqlFile = __DIR__ . '/database/schema_mysql_ecolift.sql';
        if (file_exists($sqlFile)) {
            $sql = file_get_contents($sqlFile);
            $pdoRoot->exec($sql);
        }
    }
    return $pdoRoot;
}

function fetchFullDatabaseState(PDO $pdo) {
    // 1. Productos
    $rowsProd = $pdo->query("SELECT * FROM PRODUCTO ORDER BY FIELD(tipo_isa95, 'FINISHED_GOOD', 'SUBASSEMBLY', 'RAW_MATERIAL'), id_producto")->fetchAll();
    $products = [];
    foreach ($rowsProd as $r) {
        $products[] = [
            'id' => $r['id_producto'],
            'code' => $r['sku'],
            'name' => $r['nombre'],
            'type' => $r['tipo_isa95'],
            'route' => $r['ruta_proceso'],
            'unit' => $r['unidad_medida'],
            'stdCost' => (float)$r['costo_estandar'],
            'realCost' => (float)$r['costo_real'],
            'salePrice' => (float)$r['precio_venta'],
            'stock' => (float)$r['stock_actual']
        ];
    }

    // 2. BOM Multinivel
    $rowsBom = $pdo->query("SELECT * FROM BOM ORDER BY nivel_bom ASC, id_bom ASC")->fetchAll();
    $boms = [];
    foreach ($rowsBom as $b) {
        $parent = $b['id_producto_padre'];
        if (!isset($boms[$parent])) $boms[$parent] = [];
        $boms[$parent][] = [
            'idBom' => (int)$b['id_bom'],
            'componentId' => $b['id_hijo'],
            'qtyPerUnit' => (float)$b['cantidad_requerida'],
            'unit' => $b['unidad'],
            'level' => (int)$b['nivel_bom']
        ];
    }

    // 3. Órdenes de Compra (PO)
    $rowsPo = $pdo->query("
        SELECT oc.*, pr.nombre_empresa AS supplier_name, p.nombre AS material_name
        FROM ORDEN_COMPRA oc
        LEFT JOIN PROVEEDOR pr ON oc.id_proveedor = pr.id_proveedor
        LEFT JOIN PRODUCTO p ON oc.id_producto = p.id_producto
        ORDER BY oc.fecha_emision DESC, oc.id_orden_compra DESC
    ")->fetchAll();
    $purchaseOrders = [];
    foreach ($rowsPo as $po) {
        $purchaseOrders[] = [
            'id' => $po['id_orden_compra'],
            'supplier' => $po['supplier_name'] ?: 'Maderas y Muebles S.A.',
            'materialId' => $po['id_producto'],
            'materialName' => $po['material_name'] ?: $po['id_producto'],
            'qty' => (float)$po['cantidad'],
            'unitCost' => (float)$po['costo_unitario'],
            'whin' => $po['documento_recepcion'],
            'status' => $po['estado']
        ];
    }

    // 4. Órdenes de Producción (MO)
    $rowsMo = $pdo->query("
        SELECT op.*, p.nombre AS product_name
        FROM ORDEN_PRODUCCION op
        LEFT JOIN PRODUCTO p ON op.id_producto = p.id_producto
        ORDER BY op.fecha_creacion DESC, op.id_orden_prod DESC
    ")->fetchAll();
    $manufacturingOrders = [];
    foreach ($rowsMo as $mo) {
        $manufacturingOrders[] = [
            'id' => $mo['id_orden_prod'],
            'productId' => $mo['id_producto'],
            'productName' => $mo['product_name'] ?: $mo['id_producto'],
            'qty' => (float)$mo['cantidad_lote'],
            'lotCode' => $mo['codigo_lote'],
            'plannedMin' => (int)$mo['tiempo_planificado_min'],
            'realOperatingMin' => (int)$mo['tiempo_operativo_real_min'],
            'performancePct' => 95.0,
            'batchStdCost' => (float)$mo['costo_estandar_lote'],
            'batchRealCost' => (float)$mo['costo_real_lote'],
            'componentStatus' => $mo['estado_componentes'],
            'status' => $mo['estado']
        ];
    }

    // 5. Órdenes de Venta (SO)
    $rowsSo = $pdo->query("
        SELECT ov.*, c.nombre_cliente AS customer_name, p.nombre AS product_name
        FROM ORDEN_VENTA ov
        LEFT JOIN CLIENTE c ON ov.id_cliente = c.id_cliente
        LEFT JOIN PRODUCTO p ON ov.id_producto = p.id_producto
        ORDER BY ov.fecha_pedido DESC, ov.id_orden_venta DESC
    ")->fetchAll();
    $salesOrders = [];
    foreach ($rowsSo as $so) {
        $salesOrders[] = [
            'id' => $so['id_orden_venta'],
            'customerName' => $so['customer_name'] ?: 'OfiErgo Distribuidores S.A.',
            'productId' => $so['id_producto'],
            'productName' => $so['product_name'] ?: $so['id_producto'],
            'lotCode' => $so['codigo_lote_despacho'],
            'qty' => (float)$so['cantidad'],
            'unitPrice' => (float)$so['precio_unitario'],
            'totalAmount' => (float)$so['total_venta'],
            'whout' => $so['documento_despacho'],
            'status' => $so['estado_entrega'],
            'timestamp' => substr($so['fecha_pedido'], 0, 16)
        ];
    }

    // 6. Lotes (LOTE)
    $rowsLots = $pdo->query("
        SELECT l.*, p.nombre AS product_name
        FROM LOTE l
        LEFT JOIN PRODUCTO p ON l.id_producto = p.id_producto
        ORDER BY l.id_lote DESC
    ")->fetchAll();
    $lots = [];
    foreach ($rowsLots as $l) {
        $lots[] = [
            'idLot' => (int)$l['id_lote'],
            'lotNumber' => $l['codigo_lote'],
            'productId' => $l['id_producto'],
            'productName' => $l['product_name'] ?: $l['id_producto'],
            'qty' => (float)$l['cantidad_lote'],
            'sourceDoc' => $l['documento_origen'],
            'timestamp' => substr($l['fecha_ingreso'], 0, 16)
        ];
    }

    // 7. Inspecciones de Calidad
    $rowsQc = $pdo->query("SELECT * FROM INSPECCION_CALIDAD ORDER BY fecha_inspeccion DESC, id_inspeccion DESC")->fetchAll();
    $qualityInspections = [];
    foreach ($rowsQc as $q) {
        $qualityInspections[] = [
            'id' => $q['id_inspeccion'],
            'lot' => $q['codigo_lote'],
            'inspectedQty' => (int)$q['unidades_inspeccionadas'],
            'okFirstPass' => (int)$q['unidades_ok_primera_vez'],
            'reworkedQty' => (int)$q['unidades_retrabajadas'],
            'scrapQty' => (int)$q['unidades_desecho'],
            'defect' => $q['tipo_defecto'],
            'classification' => $q['resultado'] === 'CONFORME' ? 'Conforme 100%' : ($q['resultado'] === 'RECHAZO_SCRAP' ? 'Rechazo / Scrap' : 'No Conformidad Leve'),
            'disposition' => $q['disposicion']
        ];
    }

    return [
        'status' => 'OK',
        'products' => $products,
        'boms' => $boms,
        'purchaseOrders' => $purchaseOrders,
        'manufacturingOrders' => $manufacturingOrders,
        'salesOrders' => $salesOrders,
        'lots' => $lots,
        'qualityInspections' => $qualityInspections
    ];
}

try {
    $pdo = getPdoConnection($host, $port, $dbname, $user, $pass);
    $action = $_GET['action'] ?? ($_POST['action'] ?? 'get_state');
    $input = json_decode(file_get_contents('php://input'), true) ?: [];
    if (!empty($input['action'])) $action = $input['action'];

    if ($action === 'reset_db') {
        $sqlFile = __DIR__ . '/database/schema_mysql_ecolift.sql';
        if (file_exists($sqlFile)) {
            $pdo->exec(file_get_contents($sqlFile));
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_product') {
        $id = $input['id'];
        $code = $input['code'];
        $name = $input['name'];
        $type = $input['type'];
        $unit = $input['unit'] ?? 'ud';
        $stdCost = (float)($input['stdCost'] ?? 0);
        $realCost = (float)($input['realCost'] ?? $stdCost);
        $stock = (float)($input['stock'] ?? 0);
        $parentBom = $input['parentBom'] ?? '';
        $qtyPerParent = (float)($input['qtyPerParent'] ?? 1);
        $route = $type === 'RAW_MATERIAL' ? 'Comprar' : 'Fabricar este producto';
        $alm = $type === 'FINISHED_GOOD' ? 3 : ($type === 'SUBASSEMBLY' ? 2 : 1);

        $stmt = $pdo->prepare("INSERT INTO PRODUCTO (id_producto, sku, nombre, tipo_isa95, ruta_proceso, unidad_medida, costo_estandar, costo_real, precio_venta, stock_actual, id_almacen_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$id, $code, $name, $type, $route, $unit, $stdCost, $realCost, $type === 'FINISHED_GOOD' ? 950.00 : 0.00, $stock, $alm]);

        if (!empty($parentBom) && $parentBom !== 'NONE') {
            $lvl = $parentBom === 'PROD-DUAL' ? 1 : 2;
            $stmtBom = $pdo->prepare("INSERT INTO BOM (id_producto_padre, id_hijo, nivel_bom, cantidad_requerida, unidad, merma_estimada_pct) VALUES (?, ?, ?, ?, ?, 0.00)");
            $stmtBom->execute([$parentBom, $id, $lvl, $qtyPerParent, $unit]);
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'update_product') {
        $stmt = $pdo->prepare("UPDATE PRODUCTO SET stock_actual = ?, costo_estandar = ?, costo_real = ? WHERE id_producto = ?");
        $stmt->execute([(float)$input['stock'], (float)$input['stdCost'], (float)$input['realCost'], $input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_product') {
        $pdo->prepare("DELETE FROM BOM WHERE id_hijo = ? OR id_producto_padre = ?")->execute([$input['id'], $input['id']]);
        $pdo->prepare("DELETE FROM PRODUCTO WHERE id_producto = ?")->execute([$input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_po') {
        $stmt = $pdo->prepare("INSERT INTO ORDEN_COMPRA (id_orden_compra, id_proveedor, id_producto, cantidad, costo_unitario, documento_recepcion, estado) VALUES (?, 1, ?, ?, ?, ?, 'PENDIENTE')");
        $stmt->execute([$input['id'], $input['materialId'], (float)$input['qty'], (float)$input['unitCost'], $input['whin']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'receive_po') {
        $poId = $input['id'];
        $lotNum = $input['lotNumber'];
        $stmtPo = $pdo->prepare("SELECT * FROM ORDEN_COMPRA WHERE id_orden_compra = ?");
        $stmtPo->execute([$poId]);
        $po = $stmtPo->fetch();
        if ($po && $po['estado'] !== 'RECIBIDO') {
            $pdo->prepare("UPDATE ORDEN_COMPRA SET estado = 'RECIBIDO' WHERE id_orden_compra = ?")->execute([$poId]);
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual + ? WHERE id_producto = ?")->execute([(float)$po['cantidad'], $po['id_producto']]);
            $pdo->prepare("INSERT INTO LOTE (codigo_lote, id_producto, cantidad_lote, documento_origen) VALUES (?, ?, ?, ?)")->execute([$lotNum, $po['id_producto'], (float)$po['cantidad'], $po['documento_recepcion']]);
            $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad, costo_unitario) VALUES (?, 1, ?, 'ENTRADA_COMPRA', ?, ?, ?)")->execute([$po['id_producto'], $lotNum, $po['documento_recepcion'], (float)$po['cantidad'], (float)$po['costo_unitario']]);
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_po') {
        $pdo->prepare("DELETE FROM ORDEN_COMPRA WHERE id_orden_compra = ?")->execute([$input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_mo') {
        $stmt = $pdo->prepare("INSERT INTO ORDEN_PRODUCCION (id_orden_prod, id_producto, codigo_lote, cantidad_lote, tiempo_planificado_min, tiempo_operativo_real_min, costo_estandar_lote, costo_real_lote, estado_componentes, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMADO')");
        $stmt->execute([
            $input['id'], $input['productId'], $input['lotCode'], (float)$input['qty'],
            (int)$input['plannedMin'], (int)$input['realOperatingMin'],
            (float)$input['batchStdCost'], (float)$input['batchRealCost'],
            $input['componentStatus']
        ]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'execute_mo') {
        $moId = $input['id'];
        $stmtMo = $pdo->prepare("SELECT * FROM ORDEN_PRODUCCION WHERE id_orden_prod = ?");
        $stmtMo->execute([$moId]);
        $mo = $stmtMo->fetch();
        if ($mo && $mo['estado'] !== 'HECHO') {
            $qty = (float)$mo['cantidad_lote'];
            $prodId = $mo['id_producto'];
            $stmtBom = $pdo->prepare("SELECT * FROM BOM WHERE id_producto_padre = ?");
            $stmtBom->execute([$prodId]);
            $recipe = $stmtBom->fetchAll();

            // Descontar cada componente hijo en MySQL
            foreach ($recipe as $item) {
                $consumed = round($item['cantidad_requerida'] * $qty, 2);
                $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual - ? WHERE id_producto = ?")->execute([$consumed, $item['id_hijo']]);
                $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, 2, ?, 'CONSUMO_PRODUCCION', ?, ?)")->execute([$item['id_hijo'], $mo['codigo_lote'], $moId, -$consumed]);
            }

            // Sumar producto fabricado y registrar lote
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual + ? WHERE id_producto = ?")->execute([$qty, $prodId]);
            $pdo->prepare("UPDATE ORDEN_PRODUCCION SET estado = 'HECHO', estado_componentes = 'DISPONIBLE' WHERE id_orden_prod = ?")->execute([$moId]);
            $pdo->prepare("INSERT INTO LOTE (codigo_lote, id_producto, cantidad_lote, documento_origen) VALUES (?, ?, ?, ?)")->execute([$mo['codigo_lote'], $prodId, $qty, $moId]);
            $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, 3, ?, 'ALTA_PRODUCCION', ?, ?)")->execute([$prodId, $mo['codigo_lote'], $moId, $qty]);
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_mo') {
        $pdo->prepare("DELETE FROM ORDEN_PRODUCCION WHERE id_orden_prod = ?")->execute([$input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_so') {
        $qty = (float)$input['qty'];
        $prodId = $input['productId'] ?? 'PROD-DUAL';
        $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual - ? WHERE id_producto = ?")->execute([$qty, $prodId]);
        $stmt = $pdo->prepare("INSERT INTO ORDEN_VENTA (id_orden_venta, id_cliente, id_producto, codigo_lote_despacho, cantidad, precio_unitario, total_venta, documento_despacho, estado_entrega) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'DESPACHADO')");
        $stmt->execute([$input['id'], $prodId, $input['lotCode'], $qty, (float)$input['unitPrice'], (float)$input['totalAmount'], $input['whout']]);
        $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, 3, ?, 'SALIDA_VENTA', ?, ?)")->execute([$prodId, $input['lotCode'], $input['whout'], -$qty]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_so') {
        $pdo->prepare("DELETE FROM ORDEN_VENTA WHERE id_orden_venta = ?")->execute([$input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_lot') {
        $pdo->prepare("DELETE FROM LOTE WHERE codigo_lote = ?")->execute([$input['lotNumber']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_qc') {
        $stmt = $pdo->prepare("INSERT INTO INSPECCION_CALIDAD (id_inspeccion, id_orden_prod, codigo_lote, unidades_inspeccionadas, unidades_ok_primera_vez, unidades_retrabajadas, unidades_desecho, resultado, tipo_defecto, disposicion) VALUES (?, 'WH/MO/00001', ?, ?, ?, ?, ?, ?, ?, ?)");
        $resEnum = $input['scrapQty'] > 0 ? 'RECHAZO_SCRAP' : ($input['reworkedQty'] > 0 ? 'NO_CONFORME_LEVE' : 'CONFORME');
        $stmt->execute([
            $input['id'], $input['lot'], (int)$input['inspectedQty'], (int)$input['okFirstPass'],
            (int)$input['reworkedQty'], (int)$input['scrapQty'], $resEnum, $input['defect'], $input['disposition']
        ]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_qc') {
        $pdo->prepare("DELETE FROM INSPECCION_CALIDAD WHERE id_inspeccion = ?")->execute([$input['id']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    // Por defecto: devolver estado completo desde MySQL
    echo json_encode(fetchFullDatabaseState($pdo));

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'ERROR', 'message' => $e->getMessage()]);
}
