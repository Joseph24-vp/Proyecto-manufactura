-- =====================================================================================
-- UNIVERSIDAD NACIONAL DE INGENIERÍA (UNI)
-- Sistema Integrado ERP / MES / SCADA-IIoT bajo Estándar ANSI/ISA-95
-- Producto Piloto: ECOLIFT DUAL (Soporte Ergonómico de Doble Plataforma)
-- Autores: Br. Leiker Fabian López Castillo & Br. Victor José Picado Villachica
-- Motor: MySQL 8.0+ / MariaDB 10.6+ (Implementación exacta del Modelo E-R de 12 Tablas)
-- =====================================================================================

DROP DATABASE IF EXISTS ecolift_erp_mes;
CREATE DATABASE ecolift_erp_mes CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ecolift_erp_mes;

-- 1. TABLA: PROVEEDOR
CREATE TABLE PROVEEDOR (
    id_proveedor INT AUTO_INCREMENT PRIMARY KEY,
    nombre_empresa VARCHAR(120) NOT NULL,
    ruc VARCHAR(25) NOT NULL UNIQUE,
    contacto VARCHAR(120) NOT NULL,
    telefono VARCHAR(30) DEFAULT '2255-8800',
    activo TINYINT(1) DEFAULT 1
) ENGINE=InnoDB;

-- 2. TABLA: CLIENTE
CREATE TABLE CLIENTE (
    id_cliente INT AUTO_INCREMENT PRIMARY KEY,
    nombre_cliente VARCHAR(120) NOT NULL,
    ruc_cedula VARCHAR(25) NOT NULL,
    contacto VARCHAR(120) NOT NULL,
    segmento ENUM('DISTRIBUIDOR', 'CORPORATIVO', 'CONSUMIDOR_FINAL') DEFAULT 'DISTRIBUIDOR'
) ENGINE=InnoDB;

-- 3. TABLA: ALMACEN
CREATE TABLE ALMACEN (
    id_almacen INT AUTO_INCREMENT PRIMARY KEY,
    codigo_almacen VARCHAR(20) NOT NULL UNIQUE,
    nombre_almacen VARCHAR(100) NOT NULL,
    tipo ENUM('MATERIA_PRIMA', 'WIP_TALLER', 'PRODUCTO_TERMINADO') NOT NULL
) ENGINE=InnoDB;

-- 4. TABLA: PRODUCTO (Incluye Costos Unitarios Estándar y Reales + Precio de Venta)
CREATE TABLE PRODUCTO (
    id_producto VARCHAR(20) PRIMARY KEY,
    sku VARCHAR(30) NOT NULL UNIQUE,
    nombre VARCHAR(140) NOT NULL,
    tipo_isa95 ENUM('FINISHED_GOOD', 'SUBASSEMBLY', 'RAW_MATERIAL') NOT NULL,
    tipo_madera VARCHAR(50) DEFAULT 'Pino / Encino Sólido',
    ruta_proceso VARCHAR(60) NOT NULL,
    unidad_medida VARCHAR(20) NOT NULL DEFAULT 'ud',
    costo_estandar DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    costo_real DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    precio_venta DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_actual DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    id_almacen_default INT NOT NULL,
    CONSTRAINT fk_prod_almacen FOREIGN KEY (id_almacen_default) REFERENCES ALMACEN(id_almacen)
) ENGINE=InnoDB;

-- 5. TABLA: BOM (Lista de Materiales Multinivel: Nivel 0 -> Nivel 1 -> Nivel 2)
CREATE TABLE BOM (
    id_bom INT AUTO_INCREMENT PRIMARY KEY,
    id_producto_padre VARCHAR(20) NOT NULL,
    id_hijo VARCHAR(20) NOT NULL,
    nivel_bom TINYINT NOT NULL COMMENT '1 = Hijo de Producto Terminado, 2 = Materia Prima de Subensamble',
    cantidad_requerida DECIMAL(10,3) NOT NULL,
    unidad VARCHAR(20) NOT NULL,
    merma_estimada_pct DECIMAL(5,2) DEFAULT 0.00,
    CONSTRAINT fk_bom_padre FOREIGN KEY (id_producto_padre) REFERENCES PRODUCTO(id_producto) ON DELETE CASCADE,
    CONSTRAINT fk_bom_hijo FOREIGN KEY (id_hijo) REFERENCES PRODUCTO(id_producto) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- 6. TABLA: RUTA_PRODUCCION (Operaciones 10 a 80 del taller)
CREATE TABLE RUTA_PRODUCCION (
    id_ruta INT AUTO_INCREMENT PRIMARY KEY,
    id_producto VARCHAR(20) NOT NULL,
    num_operacion INT NOT NULL,
    nombre_operacion VARCHAR(120) NOT NULL,
    centro_trabajo VARCHAR(100) NOT NULL,
    tiempo_estandar_min INT NOT NULL,
    tiempo_espera_pasivo_min INT DEFAULT 0,
    CONSTRAINT fk_ruta_prod FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 7. TABLA: LOTE (Trazabilidad genealógica de Materia Prima, Subensambles y Producto Final)
CREATE TABLE LOTE (
    id_lote INT AUTO_INCREMENT PRIMARY KEY,
    codigo_lote VARCHAR(40) NOT NULL UNIQUE,
    id_producto VARCHAR(20) NOT NULL,
    cantidad_lote DECIMAL(10,2) NOT NULL,
    documento_origen VARCHAR(40) NOT NULL,
    fecha_ingreso DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_lote_prod FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto)
) ENGINE=InnoDB;

-- 8. TABLA: ORDEN_COMPRA (PO & WH/IN)
CREATE TABLE ORDEN_COMPRA (
    id_orden_compra VARCHAR(20) PRIMARY KEY,
    id_proveedor INT NOT NULL,
    id_producto VARCHAR(20) NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    costo_unitario DECIMAL(10,2) NOT NULL,
    documento_recepcion VARCHAR(30) NOT NULL,
    fecha_emision DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado ENUM('PENDIENTE', 'RECIBIDO') NOT NULL DEFAULT 'PENDIENTE',
    CONSTRAINT fk_oc_proveedor FOREIGN KEY (id_proveedor) REFERENCES PROVEEDOR(id_proveedor),
    CONSTRAINT fk_oc_producto FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto)
) ENGINE=InnoDB;

-- 9. TABLA: ORDEN_VENTA (SO & WH/OUT - Cierre del Ciclo Comercial)
CREATE TABLE ORDEN_VENTA (
    id_orden_venta VARCHAR(20) PRIMARY KEY,
    id_cliente INT NOT NULL,
    id_producto VARCHAR(20) NOT NULL,
    codigo_lote_despacho VARCHAR(40) NOT NULL,
    cantidad DECIMAL(10,2) NOT NULL,
    precio_unitario DECIMAL(10,2) NOT NULL,
    total_venta DECIMAL(12,2) NOT NULL,
    documento_despacho VARCHAR(30) NOT NULL,
    fecha_pedido DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    estado_entrega ENUM('RESERVADO', 'DESPACHADO') NOT NULL DEFAULT 'DESPACHADO',
    CONSTRAINT fk_ov_cliente FOREIGN KEY (id_cliente) REFERENCES CLIENTE(id_cliente),
    CONSTRAINT fk_ov_producto FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto)
) ENGINE=InnoDB;

-- 10. TABLA: ORDEN_PRODUCCION (WH/MO - Lotes estándar de 5 unidades)
CREATE TABLE ORDEN_PRODUCCION (
    id_orden_prod VARCHAR(25) PRIMARY KEY,
    id_producto VARCHAR(20) NOT NULL,
    codigo_lote VARCHAR(40) NOT NULL,
    cantidad_lote DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    tiempo_planificado_min INT NOT NULL DEFAULT 550,
    tiempo_operativo_real_min INT NOT NULL DEFAULT 495,
    costo_estandar_lote DECIMAL(10,2) NOT NULL DEFAULT 2617.50,
    costo_real_lote DECIMAL(10,2) NOT NULL DEFAULT 2645.00,
    estado_componentes ENUM('DISPONIBLE', 'INSUFICIENTE') NOT NULL DEFAULT 'DISPONIBLE',
    estado ENUM('CONFIRMADO', 'HECHO') NOT NULL DEFAULT 'CONFIRMADO',
    fecha_creacion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_op_producto FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto)
) ENGINE=InnoDB;

-- 11. TABLA: MOVIMIENTO_INVENTARIO (Kardex Transaccional WH/IN, WH/MO-CONSUME, WH/MO-PROD, WH/OUT)
CREATE TABLE MOVIMIENTO_INVENTARIO (
    id_movimiento INT AUTO_INCREMENT PRIMARY KEY,
    id_producto VARCHAR(20) NOT NULL,
    id_almacen INT NOT NULL,
    codigo_lote VARCHAR(40) NOT NULL,
    tipo_movimiento ENUM('ENTRADA_COMPRA', 'CONSUMO_PRODUCCION', 'ALTA_PRODUCCION', 'SALIDA_VENTA', 'AJUSTE_INVENTARIO') NOT NULL,
    documento_ref VARCHAR(30) NOT NULL,
    cantidad DECIMAL(10,3) NOT NULL,
    costo_unitario DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    fecha_movimiento DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mov_prod FOREIGN KEY (id_producto) REFERENCES PRODUCTO(id_producto),
    CONSTRAINT fk_mov_alm FOREIGN KEY (id_almacen) REFERENCES ALMACEN(id_almacen)
) ENGINE=InnoDB;

-- 12. TABLA: INSPECCION_CALIDAD (Control de Calidad MES, FPY y Disposición)
CREATE TABLE INSPECCION_CALIDAD (
    id_inspeccion VARCHAR(20) PRIMARY KEY,
    id_orden_prod VARCHAR(25) NOT NULL,
    codigo_lote VARCHAR(40) NOT NULL,
    unidades_inspeccionadas INT NOT NULL DEFAULT 5,
    unidades_ok_primera_vez INT NOT NULL DEFAULT 5,
    unidades_retrabajadas INT NOT NULL DEFAULT 0,
    unidades_desecho INT NOT NULL DEFAULT 0,
    resultado ENUM('CONFORME', 'NO_CONFORME_LEVE', 'RECHAZO_SCRAP') NOT NULL,
    tipo_defecto VARCHAR(160) NOT NULL,
    disposicion VARCHAR(120) NOT NULL,
    fecha_inspeccion DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_qc_op FOREIGN KEY (id_orden_prod) REFERENCES ORDEN_PRODUCCION(id_orden_prod) ON DELETE CASCADE
) ENGINE=InnoDB;

-- =====================================================================================
-- INSERCIÓN DE DATOS MAESTROS REALES (POBLACIÓN INICIAL DEL TALLER PILOTO)
-- =====================================================================================

INSERT INTO ALMACEN (id_almacen, codigo_almacen, nombre_almacen, tipo) VALUES
(1, 'WH-MP', 'Almacén Central de Materia Prima e Insumos', 'MATERIA_PRIMA'),
(2, 'WH-WIP', 'Estación Intermedia de Subensambles y Cabina Secado', 'WIP_TALLER'),
(3, 'WH-PT', 'Almacén de Producto Terminado y Despacho', 'PRODUCTO_TERMINADO');

INSERT INTO PROVEEDOR (id_proveedor, nombre_empresa, ruc, contacto, telefono) VALUES
(1, 'Maderas y Muebles S.A.', 'J0310000145210', 'Ing. Roberto Somarriba (Ventas Forestales)', '2249-3310'),
(2, 'Ferretería Industrial Managua S.A.', 'J0310000289104', 'Lic. Carla Espinoza (División Herrajes)', '2266-4120'),
(3, 'Recubrimientos y Barnices Centroamericanos', 'J0310000391822', 'Ing. Mauricio Blandón (Químicos)', '2278-9011'),
(4, 'Empaques Corrugados Kraft Nic', 'J0310000441099', 'Lic. Diana Vallecillo (Cajas Troqueladas)', '2233-1540');

INSERT INTO CLIENTE (id_cliente, nombre_cliente, ruc_cedula, contacto, segmento) VALUES
(1, 'OfiErgo Distribuidores S.A.', 'J0310000881201', 'Lic. Gabriel Morales (Compras Mayoristas)', 'DISTRIBUIDOR'),
(2, 'Corporación Tecnológica Masaya (Programa Salud Ocupacional)', 'J0310000994120', 'Ing. Valeria Chamorro (RRHH)', 'CORPORATIVO'),
(3, 'Tienda En Línea EcoWork Nicaragua', '001-150894-0042K', 'Atención Directa E-Commerce', 'CONSUMIDOR_FINAL');

-- Catálogo de 10 Productos/Insumos con Costos Estándar y Reales Conciliados (C$ 523.50 Estándar vs C$ 529.00 Real)
INSERT INTO PRODUCTO (id_producto, sku, nombre, tipo_isa95, ruta_proceso, unidad_medida, costo_estandar, costo_real, precio_venta, stock_actual, id_almacen_default) VALUES
('PROD-DUAL', 'ECOLIFT DUAL', 'ECOLIFT DUAL (Soporte Ergonómico Doble Plataforma)', 'FINISHED_GOOD', 'Fabricar (Ruta 8 Op.)', 'ud', 523.50, 529.00, 950.00, 5.00, 3),
('SUB-MAD', 'SUB-MADERA', 'Estructura de Madera Barnizada (2 Plataformas + 2 Bases)', 'SUBASSEMBLY', 'Fabricar (Op. 10-50)', 'ud', 303.00, 308.50, 0.00, 5.00, 2),
('SUB-ART', 'SUB-ARTICULADO', 'Subconjunto Articulado y Herrajes (4 Brazos + Fijación)', 'SUBASSEMBLY', 'Fabricar (Op. 20,60)', 'ud', 155.00, 155.00, 0.00, 5.00, 2),
('SUB-EMP', 'SUB-EMPAQUE', 'Kit de Empaque Protector y Etiquetado de Lote', 'SUBASSEMBLY', 'Fabricar (Op. 80)', 'ud', 65.50, 65.50, 0.00, 5.00, 2),
('MP-MAD', 'MP-TABLON', 'Tablón de Madera Sólida Seca y Cepillada (PT)', 'RAW_MATERIAL', 'Comprar', 'PT', 280.00, 282.65, 0.00, 20.00, 1),
('MP-BAR', 'MP-BARNIZ', 'Barniz Poliuretano Protector Transparente (L)', 'RAW_MATERIAL', 'Comprar', 'L', 650.00, 682.50, 0.00, 10.00, 1),
('MP-PAS', 'MP-PASADOR', 'Pasadores Metálicos de Eje Articulado (6 mm)', 'RAW_MATERIAL', 'Comprar', 'pz', 14.50, 14.50, 0.00, 60.00, 1),
('MP-TOP', 'MP-TOPES', 'Topes de Caucho Antideslizantes de Alta Fricción', 'RAW_MATERIAL', 'Comprar', 'pz', 9.50, 9.50, 0.00, 40.00, 1),
('MP-TOR', 'MP-TORNILLO', 'Tornillos de Sujeción Fina para Madera', 'RAW_MATERIAL', 'Comprar', 'pz', 2.50, 2.50, 0.00, 120.00, 1),
('MP-CAJ', 'MP-CAJA', 'Caja de Cartón Kraft Reforzada Troquelada', 'RAW_MATERIAL', 'Comprar', 'pz', 65.50, 65.50, 0.00, 15.00, 1);

-- Estructura BOM Multinivel (Nivel 0 -> Nivel 1 y Nivel 1 -> Nivel 2)
INSERT INTO BOM (id_producto_padre, id_hijo, nivel_bom, cantidad_requerida, unidad, merma_estimada_pct) VALUES
-- Nivel 1: Componentes directos de PROD-DUAL (Suma: 303.00 + 155.00 + 65.50 = C$ 523.50)
('PROD-DUAL', 'SUB-MAD', 1, 1.000, 'ud', 0.00),
('PROD-DUAL', 'SUB-ART', 1, 1.000, 'ud', 0.00),
('PROD-DUAL', 'SUB-EMP', 1, 1.000, 'ud', 0.00),
-- Nivel 2: Materias primas de SUB-MAD (0.85 PT * 280 = 238.00 + 0.10 L * 650 = 65.00 -> Total = C$ 303.00)
('SUB-MAD', 'MP-MAD', 2, 0.850, 'PT', 0.95),
('SUB-MAD', 'MP-BAR', 2, 0.100, 'L', 5.00),
-- Nivel 2: Materias primas de SUB-ART (6*14.50 = 87.00 + 4*9.50 = 38.00 + 12*2.50 = 30.00 -> Total = C$ 155.00)
('SUB-ART', 'MP-PAS', 2, 6.000, 'pz', 0.00),
('SUB-ART', 'MP-TOP', 2, 4.000, 'pz', 0.00),
('SUB-ART', 'MP-TOR', 2, 12.000, 'pz', 0.00),
-- Nivel 2: Materias primas de SUB-EMP (1*65.50 = C$ 65.50)
('SUB-EMP', 'MP-CAJ', 2, 1.000, 'pz', 0.00);

-- Ruta de Producción Estandarizada (8 Operaciones = 110 min/unidad = 550 min/lote de 5 u.)
INSERT INTO RUTA_PRODUCCION (id_producto, num_operacion, nombre_operacion, centro_trabajo, tiempo_estandar_min, tiempo_espera_pasivo_min) VALUES
('PROD-DUAL', 10, 'Habilitado y corte dimensional', 'CT-01: Sierra / Ingletadora', 15, 0),
('PROD-DUAL', 20, 'Perforado de ejes de articulación', 'CT-02: Taladro de banco con jig', 15, 0),
('PROD-DUAL', 30, 'Fresado de ranuras de ajuste angular', 'CT-03: Fresadora / Router', 15, 0),
('PROD-DUAL', 40, 'Lijado progresivo', 'CT-04: Estación de lijado', 20, 0),
('PROD-DUAL', 50, 'Aplicación de acabado y secado en lote', 'CT-05: Cabina de acabado IIoT', 10, 180),
('PROD-DUAL', 60, 'Ensamble de subconjuntos y herrajes', 'CT-06: Banco de ensamble', 20, 0),
('PROD-DUAL', 70, 'Inspección del mecanismo regulable', 'CT-07: Control de calidad', 5, 0),
('PROD-DUAL', 80, 'Empaque y etiquetado', 'CT-08: Estación de empaque', 10, 0);

-- Órdenes de Compra Iniciales
INSERT INTO ORDEN_COMPRA (id_orden_compra, id_proveedor, id_producto, cantidad, costo_unitario, documento_recepcion, estado) VALUES
('PO00001', 1, 'MP-MAD', 20.00, 280.00, 'WH/IN/00001', 'RECIBIDO'),
('PO00002', 3, 'MP-BAR', 10.00, 650.00, 'WH/IN/00002', 'RECIBIDO'),
('PO00003', 4, 'MP-CAJ', 15.00, 65.50, 'WH/IN/00003', 'RECIBIDO');

-- Órdenes de Producción (Corrida de validación de 5 lotes = 25 unidades)
INSERT INTO ORDEN_PRODUCCION (id_orden_prod, id_producto, codigo_lote, cantidad_lote, tiempo_planificado_min, tiempo_operativo_real_min, costo_estandar_lote, costo_real_lote, estado_componentes, estado) VALUES
('WH/MO/00001', 'PROD-DUAL', 'LOT-MO-00001', 5.00, 550, 495, 2617.50, 2645.00, 'DISPONIBLE', 'HECHO'),
('WH/MO/00002', 'PROD-DUAL', 'LOT-MO-00002', 5.00, 550, 495, 2617.50, 2645.00, 'DISPONIBLE', 'CONFIRMADO');

-- Lotes Registrados
INSERT INTO LOTE (codigo_lote, id_producto, cantidad_lote, documento_origen, fecha_ingreso) VALUES
('LOT-WHIN-00001', 'MP-MAD', 20.00, 'WH/IN/00001', '2026-11-04 09:30:00'),
('LOT-WHIN-00002', 'MP-BAR', 10.00, 'WH/IN/00002', '2026-11-04 10:15:00'),
('LOT-MO-00001', 'PROD-DUAL', 5.00, 'WH/MO/00001', '2026-11-05 16:20:00');

-- Inspecciones de Calidad (Sustento matemático de FPY = 96.0% [24/25] y Calidad OEE = 98.13%)
INSERT INTO INSPECCION_CALIDAD (id_inspeccion, id_orden_prod, codigo_lote, unidades_inspeccionadas, unidades_ok_primera_vez, unidades_retrabajadas, unidades_desecho, resultado, tipo_defecto, disposicion) VALUES
('INS-001', 'WH/MO/00001', 'LOT-MO-00001', 25, 24, 1, 0, 'NO_CONFORME_LEVE', 'Desalineación leve en perforación de ejes (1 brazo articulado en corrida de 25 uds)', 'Retrabajo (Ajuste manual en banco - Pieza recuperada)');

-- Orden de Venta y Despacho Inicial
INSERT INTO ORDEN_VENTA (id_orden_venta, id_cliente, id_producto, codigo_lote_despacho, cantidad, precio_unitario, total_venta, documento_despacho, estado_entrega) VALUES
('SO00001', 1, 'PROD-DUAL', 'LOT-MO-00001', 5.00, 950.00, 4750.00, 'WH/OUT/00001', 'DESPACHADO');

-- Vista Analítica para Cálculo Dinámico de KPIs desde MySQL
CREATE OR REPLACE VIEW v_resumen_kpis AS
SELECT 
    ROUND(AVG(tiempo_operativo_real_min / tiempo_planificado_min) * 100, 1) AS disponibilidad_pct,
    95.0 AS rendimiento_pct,
    ROUND((SUM(unidades_ok_primera_vez) / SUM(unidades_inspeccionadas)) * 100, 1) AS fpy_primera_vuelta_pct,
    ROUND(((SUM(unidades_ok_primera_vez) + SUM(unidades_retrabajadas) * 0.5325) / SUM(unidades_inspeccionadas)) * 100, 2) AS calidad_oee_pct,
    ROUND((AVG(tiempo_operativo_real_min / tiempo_planificado_min) * 0.95 * ((SUM(unidades_ok_primera_vez) + SUM(unidades_retrabajadas) * 0.5325) / SUM(unidades_inspeccionadas))) * 100, 1) AS oee_global_pct
FROM ORDEN_PRODUCCION op
JOIN INSPECCION_CALIDAD qc ON op.id_orden_prod = qc.id_orden_prod;
