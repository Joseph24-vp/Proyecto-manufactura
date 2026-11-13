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
// Aplicación de demostración local: no permitir llamadas desde orígenes externos.
// La protección de producción (autenticación/CSRF) queda fuera del alcance del piloto.
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$config = require __DIR__ . '/config.php';
$host = $config['host'];
$port = (string)$config['port'];
$dbname = $config['dbname'];
$user = $config['user'];
$pass = $config['pass'];

function getPdoConnection($host, $port, $dbname, $user, $pass) {
    $pdoRoot = new PDO("mysql:host=$host;port=$port;charset=utf8mb4", $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC
    ]);
    $pdoRoot->exec("CREATE DATABASE IF NOT EXISTS `$dbname` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    $pdoRoot->exec("USE `$dbname`");

    // La importación inicial se realiza una sola vez desde phpMyAdmin.
    // No ejecutar el SQL automáticamente: contiene DROP DATABASE en la versión piloto
    // y podría borrar información que el usuario ya haya registrado.
    $stmt = $pdoRoot->query("SHOW TABLES LIKE 'PRODUCTO'");
    if ($stmt->rowCount() === 0) {
        throw new RuntimeException('Primero importe database/schema_mysql_ecolift.sql desde phpMyAdmin. Consulte LEEME_INSTALACION.txt.');
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
        throw new RuntimeException('Reinicio deshabilitado para proteger sus datos. Use la exportación/copia desde phpMyAdmin si necesita restaurarlos.');
    }

    // No permitir acciones de escritura por GET. La consulta get_state sí se permite.
    if ($action !== 'get_state' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
        http_response_code(405);
        throw new RuntimeException('Esta operación requiere POST.');
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
        if (!in_array($type, ['RAW_MATERIAL','SUBASSEMBLY','FINISHED_GOOD'], true) || $id === '' || strlen($id) > 20 || trim($name) === '' || $stdCost < 0 || $realCost < 0 || $stock < 0 || $qtyPerParent <= 0) {
            throw new RuntimeException('Revise el código, nombre, tipo, costo, stock y cantidad BOM del producto.');
        }
        $route = $type === 'RAW_MATERIAL' ? 'Comprar' : 'Fabricar este producto';
        $alm = $type === 'FINISHED_GOOD' ? 3 : ($type === 'SUBASSEMBLY' ? 2 : 1);

        $pdo->beginTransaction();
        try {
            $stmt = $pdo->prepare("INSERT INTO PRODUCTO (id_producto, sku, nombre, tipo_isa95, ruta_proceso, unidad_medida, costo_estandar, costo_real, precio_venta, stock_actual, id_almacen_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $stmt->execute([$id, $code, $name, $type, $route, $unit, $stdCost, $realCost, $type === 'FINISHED_GOOD' ? 950.00 : 0.00, $stock, $alm]);
            if (!empty($parentBom) && $parentBom !== 'NONE') {
                $check = $pdo->prepare("SELECT tipo_isa95 FROM PRODUCTO WHERE id_producto=?");
                $check->execute([$parentBom]);
                $parentType = $check->fetchColumn();
                if (!$parentType || $parentType === 'RAW_MATERIAL' || ($parentType === 'FINISHED_GOOD' && $type !== 'SUBASSEMBLY') || ($parentType === 'SUBASSEMBLY' && $type !== 'RAW_MATERIAL')) {
                    throw new RuntimeException('Relación BOM inválida: producto final → subensamble → materia prima.');
                }
                $lvl = $parentType === 'FINISHED_GOOD' ? 1 : 2;
                $stmtBom = $pdo->prepare("INSERT INTO BOM (id_producto_padre, id_hijo, nivel_bom, cantidad_requerida, unidad, merma_estimada_pct) VALUES (?, ?, ?, ?, ?, 0.00)");
                $stmtBom->execute([$parentBom, $id, $lvl, $qtyPerParent, $unit]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'update_product') {
        $id = (string)($input['id'] ?? '');
        $newStock = (float)($input['stock'] ?? -1);
        $std = (float)($input['stdCost'] ?? -1);
        $real = (float)($input['realCost'] ?? -1);
        if (!is_finite($newStock) || !is_finite($std) || !is_finite($real) || min($newStock, $std, $real) < 0) {
            throw new RuntimeException('Stock y costos deben ser números mayores o iguales a cero.');
        }
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare("SELECT stock_actual,id_almacen_default FROM PRODUCTO WHERE id_producto=? FOR UPDATE");
            $st->execute([$id]);
            $old = $st->fetch();
            if (!$old) throw new RuntimeException('Producto no encontrado.');
            $delta = round($newStock - (float)$old['stock_actual'], 3);
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual=?, costo_estandar=?, costo_real=? WHERE id_producto=?")
                ->execute([$newStock, $std, $real, $id]);
            if (abs($delta) > 0.0001) {
                $documento = 'AJ-' . date('ymdHis');
                $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto,id_almacen,codigo_lote,tipo_movimiento,documento_ref,cantidad,costo_unitario) VALUES (?, ?, ?, 'AJUSTE_INVENTARIO', ?, ?, ?)")
                    ->execute([$id, (int)$old['id_almacen_default'], $documento, $documento, $delta, $real]);
            }
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_product') {
        $id = (string)($input['id'] ?? '');
        foreach (['BOM'=>['id_producto_padre','id_hijo'], 'ORDEN_COMPRA'=>['id_producto'], 'ORDEN_PRODUCCION'=>['id_producto'], 'ORDEN_VENTA'=>['id_producto'], 'LOTE'=>['id_producto'], 'MOVIMIENTO_INVENTARIO'=>['id_producto'], 'RUTA_PRODUCCION'=>['id_producto']] as $tabla => $columnas) {
            foreach ($columnas as $columna) {
                $st = $pdo->prepare("SELECT COUNT(*) FROM `$tabla` WHERE `$columna`=?");
                $st->execute([$id]);
                if ((int)$st->fetchColumn() > 0) throw new RuntimeException('No se puede eliminar: este producto está vinculado a BOM, órdenes, lotes o movimientos.');
            }
        }
        $pdo->prepare("DELETE FROM PRODUCTO WHERE id_producto=?")->execute([$id]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_po') {
        $qty = (float)($input['qty'] ?? 0);
        $cost = (float)($input['unitCost'] ?? -1);
        if (!is_finite($qty) || !is_finite($cost) || $qty <= 0 || $cost < 0) throw new RuntimeException('Cantidad y costo de compra inválidos.');
        $check = $pdo->prepare("SELECT tipo_isa95 FROM PRODUCTO WHERE id_producto=?");
        $check->execute([$input['materialId'] ?? '']);
        if ($check->fetchColumn() !== 'RAW_MATERIAL') throw new RuntimeException('Seleccione una materia prima válida.');
        $stmt = $pdo->prepare("INSERT INTO ORDEN_COMPRA (id_orden_compra, id_proveedor, id_producto, cantidad, costo_unitario, documento_recepcion, estado) VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE')");
        $stmt->execute([$input['id'], (int)($input['supplierId'] ?? 1), $input['materialId'], (float)$input['qty'], (float)$input['unitCost'], $input['whin']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'receive_po') {
        $pdo->beginTransaction();
        try {
            $poId = (string)($input['id'] ?? '');
            $lotNum = (string)($input['lotNumber'] ?? '');
            if (!$lotNum || strlen($lotNum) > 40) throw new RuntimeException('Indique un código de lote válido.');
            $stmtPo = $pdo->prepare("SELECT * FROM ORDEN_COMPRA WHERE id_orden_compra=? FOR UPDATE");
            $stmtPo->execute([$poId]);
            $po = $stmtPo->fetch();
            if (!$po) throw new RuntimeException('Orden de compra inexistente.');
            if ($po['estado'] !== 'PENDIENTE') throw new RuntimeException('La orden ya fue recibida.');
            $pdo->prepare("INSERT INTO LOTE (codigo_lote,id_producto,cantidad_lote,documento_origen) VALUES (?,?,?,?)")
                ->execute([$lotNum, $po['id_producto'], (float)$po['cantidad'], $po['documento_recepcion']]);
            $pdo->prepare("UPDATE ORDEN_COMPRA SET estado='RECIBIDO' WHERE id_orden_compra=?")->execute([$poId]);
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual=stock_actual+? WHERE id_producto=?")
                ->execute([(float)$po['cantidad'], $po['id_producto']]);
            $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto,id_almacen,codigo_lote,tipo_movimiento,documento_ref,cantidad,costo_unitario) VALUES (?,1,?,'ENTRADA_COMPRA',?,?,?)")
                ->execute([$po['id_producto'], $lotNum, $po['documento_recepcion'], (float)$po['cantidad'], (float)$po['costo_unitario']]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_po') {
        $st = $pdo->prepare("DELETE FROM ORDEN_COMPRA WHERE id_orden_compra=? AND estado='PENDIENTE'");
        $st->execute([$input['id'] ?? '']);
        if ($st->rowCount() === 0) throw new RuntimeException('Solo se pueden eliminar compras pendientes.');
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_mo') {
        $qty = (float)($input['qty'] ?? 0);
        $prodId = $input['productId'] ?? '';
        if (!is_finite($qty) || $qty <= 0) throw new RuntimeException('La cantidad a fabricar debe ser positiva.');
        $check = $pdo->prepare("SELECT tipo_isa95 FROM PRODUCTO WHERE id_producto=?");
        $check->execute([$prodId]);
        if (!in_array($check->fetchColumn(), ['FINISHED_GOOD','SUBASSEMBLY'], true)) throw new RuntimeException('Seleccione un producto fabricable.');
        $check = $pdo->prepare("SELECT COUNT(*) FROM BOM WHERE id_producto_padre=?");
        $check->execute([$prodId]);
        if ((int)$check->fetchColumn() === 0) throw new RuntimeException('Configure los materiales de la BOM antes de fabricar.');
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
        $pdo->beginTransaction();
        try {
            $moId = $input['id'] ?? '';
            $stmtMo = $pdo->prepare("SELECT * FROM ORDEN_PRODUCCION WHERE id_orden_prod = ? FOR UPDATE");
            $stmtMo->execute([$moId]);
            $mo = $stmtMo->fetch();
            if (!$mo) throw new RuntimeException('No existe la orden de manufactura seleccionada.');
            if ($mo['estado'] === 'HECHO') throw new RuntimeException('Esta orden ya fue producida.');
            $qty = (float)$mo['cantidad_lote'];
            if ($qty <= 0) throw new RuntimeException('La cantidad del lote debe ser positiva.');

            $stmtBom = $pdo->prepare("SELECT * FROM BOM WHERE id_producto_padre = ? ORDER BY id_bom");
            $stmtBom->execute([$mo['id_producto']]);
            $recipe = $stmtBom->fetchAll();
            if (!$recipe) throw new RuntimeException('El producto no tiene una BOM configurada.');

            $locked = $pdo->prepare("SELECT stock_actual, id_almacen_default FROM PRODUCTO WHERE id_producto = ? FOR UPDATE");
            foreach ($recipe as $item) {
                $consumed = round((float)$item['cantidad_requerida'] * $qty, 3);
                $locked->execute([$item['id_hijo']]);
                $component = $locked->fetch();
                if (!$component || (float)$component['stock_actual'] + 0.0001 < $consumed) {
                    throw new RuntimeException('Stock insuficiente de ' . $item['id_hijo'] . ': requiere ' . $consumed);
                }
                $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual - ? WHERE id_producto = ?")
                    ->execute([$consumed, $item['id_hijo']]);
                $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, ?, ?, 'CONSUMO_PRODUCCION', ?, ?)")
                    ->execute([$item['id_hijo'], (int)$component['id_almacen_default'], $mo['codigo_lote'], $moId, -$consumed]);
            }
            $locked->execute([$mo['id_producto']]);
            $fabricado = $locked->fetch();
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual = stock_actual + ? WHERE id_producto = ?")
                ->execute([$qty, $mo['id_producto']]);
            $pdo->prepare("UPDATE ORDEN_PRODUCCION SET estado = 'HECHO', estado_componentes = 'DISPONIBLE' WHERE id_orden_prod = ?")
                ->execute([$moId]);
            $pdo->prepare("INSERT INTO LOTE (codigo_lote, id_producto, cantidad_lote, documento_origen) VALUES (?, ?, ?, ?)")
                ->execute([$mo['codigo_lote'], $mo['id_producto'], $qty, $moId]);
            $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, ?, ?, 'ALTA_PRODUCCION', ?, ?)")
                ->execute([$mo['id_producto'], (int)$fabricado['id_almacen_default'], $mo['codigo_lote'], $moId, $qty]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_mo') {
        $st = $pdo->prepare("DELETE FROM ORDEN_PRODUCCION WHERE id_orden_prod=? AND estado='CONFIRMADO'");
        $st->execute([$input['id'] ?? '']);
        if ($st->rowCount() === 0) throw new RuntimeException('Solo se pueden borrar órdenes de manufactura pendientes.');
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'create_so') {
        $pdo->beginTransaction();
        try {
            $qty = (float)($input['qty'] ?? 0);
            $prodId = $input['productId'] ?? 'PROD-DUAL';
            $lotCode = $input['lotCode'] ?? '';
            $clientId = (int)($input['customerId'] ?? 1);
            if ($qty <= 0) throw new RuntimeException('La cantidad de venta debe ser positiva.');
            $st = $pdo->prepare("SELECT stock_actual, id_almacen_default FROM PRODUCTO WHERE id_producto=? AND tipo_isa95='FINISHED_GOOD' FOR UPDATE");
            $st->execute([$prodId]);
            $prod = $st->fetch();
            if (!$prod || (float)$prod['stock_actual'] < $qty) throw new RuntimeException('No hay producto terminado suficiente para despachar.');
            $st = $pdo->prepare("SELECT cantidad_lote FROM LOTE WHERE codigo_lote=? AND id_producto=? FOR UPDATE");
            $st->execute([$lotCode, $prodId]);
            $lot = $st->fetch();
            if (!$lot) throw new RuntimeException('El lote de producto terminado no existe.');
            $st = $pdo->prepare("SELECT COALESCE(SUM(cantidad),0) FROM ORDEN_VENTA WHERE codigo_lote_despacho=? AND estado_entrega='DESPACHADO'");
            $st->execute([$lotCode]);
            $sold = (float)$st->fetchColumn();
            if ((float)$lot['cantidad_lote'] - $sold < $qty) throw new RuntimeException('El lote seleccionado no tiene suficientes unidades disponibles.');
            $st = $pdo->prepare("SELECT resultado FROM INSPECCION_CALIDAD WHERE codigo_lote=? ORDER BY fecha_inspeccion DESC LIMIT 1");
            $st->execute([$lotCode]);
            $qc = $st->fetch();
            if (!$qc || $qc['resultado'] === 'RECHAZO_SCRAP') throw new RuntimeException('El lote no tiene liberación de calidad válida para despacho.');
            $st = $pdo->prepare("SELECT unidades_ok_primera_vez, unidades_retrabajadas FROM INSPECCION_CALIDAD WHERE codigo_lote=? ORDER BY fecha_inspeccion DESC LIMIT 1");
            $st->execute([$lotCode]);
            $ins = $st->fetch();
            if (!$ins || (float)$ins['unidades_ok_primera_vez'] + (float)$ins['unidades_retrabajadas'] - $sold < $qty) {
                throw new RuntimeException('Cantidad a despachar mayor que unidades liberadas por calidad.');
            }
            $st = $pdo->prepare("SELECT id_cliente FROM CLIENTE WHERE id_cliente=?");
            $st->execute([$clientId]);
            if (!$st->fetch()) throw new RuntimeException('Seleccione un cliente válido.');

            $price = (float)($input['unitPrice'] ?? 0);
            if (!is_finite($price) || $price <= 0) throw new RuntimeException('El precio de venta debe ser positivo.');
            $pdo->prepare("INSERT INTO ORDEN_VENTA (id_orden_venta, id_cliente, id_producto, codigo_lote_despacho, cantidad, precio_unitario, total_venta, documento_despacho, estado_entrega) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DESPACHADO')")
                ->execute([$input['id'], $clientId, $prodId, $lotCode, $qty, $price, round($price*$qty, 2), $input['whout']]);
            $pdo->prepare("UPDATE PRODUCTO SET stock_actual=stock_actual-? WHERE id_producto=?")
                ->execute([$qty, $prodId]);
            $pdo->prepare("INSERT INTO MOVIMIENTO_INVENTARIO (id_producto, id_almacen, codigo_lote, tipo_movimiento, documento_ref, cantidad) VALUES (?, ?, ?, 'SALIDA_VENTA', ?, ?)")
                ->execute([$prodId, (int)$prod['id_almacen_default'], $lotCode, $input['whout'], -$qty]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            throw $e;
        }
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_so') {
        throw new RuntimeException('No se pueden eliminar ventas despachadas: se debe conservar el historial de auditoría.');
    }

    if ($action === 'delete_lot') {
        throw new RuntimeException('Los lotes se conservan para asegurar trazabilidad y auditoría.');
    }

    if ($action === 'create_qc') {
        $lot = $input['lot'] ?? '';
        $stmt = $pdo->prepare("SELECT id_orden_prod, cantidad_lote FROM ORDEN_PRODUCCION WHERE codigo_lote=? AND estado='HECHO' LIMIT 1");
        $stmt->execute([$lot]);
        $mo = $stmt->fetch();
        if (!$mo) throw new RuntimeException('El lote indicado no pertenece a una orden de producción finalizada.');
        $already = $pdo->prepare("SELECT COUNT(*) FROM INSPECCION_CALIDAD WHERE codigo_lote=?");
        $already->execute([$lot]);
        if ((int)$already->fetchColumn() > 0) throw new RuntimeException('Este lote ya tiene una inspección registrada.');
        $inspected = (int)($input['inspectedQty'] ?? 0);
        $ok = (int)($input['okFirstPass'] ?? 0);
        $rework = (int)($input['reworkedQty'] ?? 0);
        $scrap = (int)($input['scrapQty'] ?? 0);
        if ($inspected <= 0 || $inspected > (float)$mo['cantidad_lote'] || $ok < 0 || $rework < 0 || $scrap < 0 || $ok + $rework + $scrap > $inspected) {
            throw new RuntimeException('Cantidades de inspección inválidas para este lote.');
        }
        $resEnum = $scrap > 0 ? 'RECHAZO_SCRAP' : ($rework > 0 ? 'NO_CONFORME_LEVE' : 'CONFORME');
        $stmt = $pdo->prepare("INSERT INTO INSPECCION_CALIDAD (id_inspeccion, id_orden_prod, codigo_lote, unidades_inspeccionadas, unidades_ok_primera_vez, unidades_retrabajadas, unidades_desecho, resultado, tipo_defecto, disposicion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $stmt->execute([$input['id'], $mo['id_orden_prod'], $lot, $inspected, $ok, $rework, $scrap, $resEnum, $input['defect'], $input['disposition']]);
        echo json_encode(fetchFullDatabaseState($pdo));
        exit;
    }

    if ($action === 'delete_qc') {
        throw new RuntimeException('Las inspecciones registradas se conservan como evidencia de calidad.');
    }

    if ($action !== 'get_state') throw new RuntimeException('Acción no reconocida.');
    // Consulta única de estado del sistema desde MySQL.
    echo json_encode(fetchFullDatabaseState($pdo));

} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['status' => 'ERROR', 'message' => $e->getMessage()]);
}
