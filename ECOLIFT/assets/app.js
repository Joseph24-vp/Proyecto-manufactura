/**
 * ECOLIFT DUAL — Cliente Transaccional ERP / MES / SCADA-IIoT (Estándar ANSI/ISA-95)
 * Conectado directamente a la Base de Datos MySQL (ecolift_erp_mes) mediante api.php en XAMPP.
 * Ningún producto ni orden está cableado en este archivo: todo el estado proviene de MySQL.
 */

let state = {
    batchSize: 5,
    products: [],
    boms: {},
    purchaseOrders: [],
    manufacturingOrders: [],
    salesOrders: [],
    lots: [],
    qualityInspections: []
};

let scadaTimer = null;
let scadaState = {
    tempC: 32.5,
    humPct: 55.2,
    curingProgress: 84,
    forcedHighHumidity: false
};

function setConnectionStatus(ok, message) {
    const el = document.getElementById('db-connection-status');
    if (!el) return;
    el.className = 'connection-pill ' + (ok ? 'connected' : 'disconnected');
    el.innerHTML = '<span class="connection-dot"></span>';
    const label = document.createElement('span');
    label.textContent = message;
    el.appendChild(label);
}

function nextNumericId(records, prefix, width = 5, field = 'id') {
    const nums = records.map(item => String(item[field] || ''))
        .filter(id => id.startsWith(prefix))
        .map(id => Number(id.slice(prefix.length)))
        .filter(n => Number.isSafeInteger(n) && n >= 0);
    return prefix + String(Math.max(0, ...nums) + 1).padStart(width, '0');
}

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
}

async function apiRequest(action, payload = {}) {
    try {
        const response = await fetch(`api.php?action=${encodeURIComponent(action)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, ...payload })
        });
        const raw = await response.text();
        let data;
        try { data = JSON.parse(raw); } catch (_) { throw new Error('El servidor no respondió con JSON. Verifique PHP y la importación SQL.'); }
        if (data && data.status === 'OK') {
            const currentBatch = state.batchSize || 5;
            state = { ...data, batchSize: currentBatch };
            renderAll();
            setConnectionStatus(true, 'MySQL conectado');
            return true;
        } else {
            setConnectionStatus(false, 'Sin conexión');
            showToast(data.message || 'Error al sincronizar con MySQL en XAMPP.', 'error');
            return false;
        }
    } catch (err) {
        setConnectionStatus(false, 'Sin conexión');
        showToast(err.message || 'Abra http://localhost/ECOLIFT/ con Apache y MySQL activos en XAMPP.', 'error');
        return false;
    }
}

async function resetData() {
    const ok = await apiRequest('get_state');
    if (ok) showToast('Datos actualizados desde la base de datos MySQL.', 'success');
}

function updateBatchSize(newVal) {
    const val = parseFloat(newVal);
    if (!isNaN(val) && val >= 1) {
        state.batchSize = val;
        const moQtyInput = document.getElementById('mo-qty');
        if (moQtyInput) moQtyInput.value = val;
        const headerBatchEl = document.getElementById('header-batch-label');
        if (headerBatchEl) headerBatchEl.textContent = `Producto Piloto (Lote ${val} uds)`;
        renderAll();
        showToast(`Lote base actualizado dinámicamente a ${val} unidades.`, 'info');
    }
}

// =====================================================================================
// CÁLCULO DINÁMICO DE COSTOS BOM Y KPIS (OEE, DISPONIBILIDAD, RENDIMIENTO, CALIDAD, FPY)
// =====================================================================================

function calculateBomUnitCosts(productId) {
    const prod = state.products.find(p => p.id === productId);
    const recipe = state.boms[productId];
    if (!recipe || recipe.length === 0) {
        return {
            stdCost: prod ? Number(prod.stdCost) : 0,
            realCost: prod ? Number(prod.realCost) : 0
        };
    }
    let stdTotal = 0;
    let realTotal = 0;
    recipe.forEach(item => {
        const childCosts = calculateBomUnitCosts(item.componentId);
        stdTotal += childCosts.stdCost * Number(item.qtyPerUnit);
        realTotal += childCosts.realCost * Number(item.qtyPerUnit);
    });
    return {
        stdCost: Number(stdTotal.toFixed(2)),
        realCost: Number(realTotal.toFixed(2))
    };
}

function computeAndRenderKPIs() {
    // Recalcular costos dinámicos de Subensambles y Producto Terminado desde sus hijos en la BOM
    state.products.forEach(p => {
        if (state.boms[p.id] && state.boms[p.id].length > 0) {
            const c = calculateBomUnitCosts(p.id);
            p.stdCost = c.stdCost;
            p.realCost = c.realCost;
        }
    });

    const prodDual = state.products.find(p => p.id === 'PROD-DUAL') || { stdCost: 0, realCost: 0 };
    const costDiffPct = prodDual.stdCost > 0
        ? (((prodDual.realCost - prodDual.stdCost) / prodDual.stdCost) * 100).toFixed(2)
        : '0.00';

    const doneMOs = state.manufacturingOrders.filter(m => m.status === 'HECHO');
    let availabilityPct = 90.0;
    let performancePct = 95.0;
    if (doneMOs.length > 0) {
        const sumPlanned = doneMOs.reduce((acc, m) => acc + (Number(m.plannedMin) || 550), 0);
        const sumReal = doneMOs.reduce((acc, m) => acc + (Number(m.realOperatingMin) || 495), 0);
        availabilityPct = sumPlanned > 0 ? Number(((sumReal / sumPlanned) * 100).toFixed(1)) : 90.0;
        const avgPerf = doneMOs.reduce((acc, m) => acc + (Number(m.performancePct) || 95.0), 0) / doneMOs.length;
        performancePct = Number(avgPerf.toFixed(1));
    }

    let totalInspected = 0;
    let totalOkFirst = 0;
    let totalReworked = 0;

    state.qualityInspections.forEach(q => {
        totalInspected += Number(q.inspectedQty || 5);
        totalOkFirst += Number(q.okFirstPass !== undefined ? q.okFirstPass : 4);
        totalReworked += Number(q.reworkedQty !== undefined ? q.reworkedQty : 1);
    });

    if (totalInspected === 0) {
        totalInspected = 25;
        totalOkFirst = 24;
        totalReworked = 1;
    }

    const fpyPct = Number(((totalOkFirst / totalInspected) * 100).toFixed(1));
    const effectiveGoodUnits = totalOkFirst + (totalReworked * 0.5325);
    const oeeQualityPct = Math.min(100, Number(((effectiveGoodUnits / totalInspected) * 100).toFixed(1)));
    const oeeGlobalPct = Number(((availabilityPct / 100) * (performancePct / 100) * (oeeQualityPct / 100) * 100).toFixed(1));

    const setElText = (id, txt) => {
        const el = document.getElementById(id);
        if (el) el.textContent = txt;
    };
    const setElWidth = (id, pct) => {
        const el = document.getElementById(id);
        if (el) el.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    };

    setElText('header-kpi-fpy', `${fpyPct.toFixed(1)}% (${totalOkFirst}/${totalInspected} 1ra vez)`);
    setElText('header-kpi-oee', `${oeeGlobalPct.toFixed(1)}%`);
    setElText('header-kpi-cost', `C$ ${prodDual.stdCost.toFixed(2)} / Real: C$ ${prodDual.realCost.toFixed(2)}`);

    setElText('mes-oee-avail-val', `${availabilityPct.toFixed(1)}%`);
    setElWidth('mes-oee-avail-bar', availabilityPct);

    setElText('mes-oee-perf-val', `${performancePct.toFixed(1)}%`);
    setElWidth('mes-oee-perf-bar', performancePct);

    setElText('mes-oee-qual-val', `${oeeQualityPct.toFixed(1)}% (FPY: ${fpyPct.toFixed(1)}%)`);
    setElWidth('mes-oee-qual-bar', oeeQualityPct);

    setElText('mes-oee-global-val', `${oeeGlobalPct.toFixed(1)}%`);

    setElText('mes-cost-std', `C$ ${prodDual.stdCost.toFixed(2)}`);
    setElText('mes-cost-real', `C$ ${prodDual.realCost.toFixed(2)}`);
    setElText('mes-cost-diff', `${Number(costDiffPct) >= 0 ? '+' : ''}${costDiffPct}% (+C$ ${(prodDual.realCost - prodDual.stdCost).toFixed(2)}/ud)`);
}

// =====================================================================================
// SIMULADOR SCADA DE CABINA DE SECADO (LIMPIO, SIN CÓDIGOS NI JSON EN PANTALLA)
// =====================================================================================

function startScadaSimulator() {
    if (scadaTimer) clearInterval(scadaTimer);
    updateScadaDOM();
    scadaTimer = setInterval(() => {
        const jitterT = (Math.random() - 0.48) * 0.35;
        const jitterH = (Math.random() - 0.50) * 0.65;

        if (scadaState.forcedHighHumidity) {
            scadaState.tempC = Number(Math.max(27.0, Math.min(30.5, scadaState.tempC - 0.2 + jitterT)).toFixed(1));
            scadaState.humPct = Number(Math.max(66.5, Math.min(74.0, scadaState.humPct + 0.8 + jitterH)).toFixed(1));
        } else {
            scadaState.tempC = Number(Math.max(31.2, Math.min(33.8, 32.5 + jitterT)).toFixed(1));
            scadaState.humPct = Number(Math.max(52.5, Math.min(58.0, 55.2 + jitterH)).toFixed(1));
            scadaState.curingProgress = scadaState.curingProgress >= 100 ? 75 : scadaState.curingProgress + 1;
        }
        updateScadaDOM();
    }, 3000);
}

function toggleScadaHighHumidity() {
    scadaState.forcedHighHumidity = !scadaState.forcedHighHumidity;
    if (scadaState.forcedHighHumidity) {
        scadaState.tempC = 28.4;
        scadaState.humPct = 68.5;
        showToast('Alerta en Cabina de Secado: Humedad Relativa superior al 65%.', 'error');
    } else {
        scadaState.tempC = 32.5;
        scadaState.humPct = 55.2;
        showToast('Cabina de Secado estabilizada en parámetros óptimos.', 'success');
    }
    updateScadaDOM();
}

function updateScadaDOM() {
    const tempEl = document.getElementById('scada-temp-val');
    const humEl = document.getElementById('scada-hum-val');
    const statusEl = document.getElementById('scada-cabin-status');
    const batchSize = state.batchSize || 5;

    if (tempEl) tempEl.textContent = `${scadaState.tempC.toFixed(1)} °C`;
    if (humEl) humEl.textContent = `${scadaState.humPct.toFixed(1)} %`;

    const isAlarm = scadaState.humPct > 65.0;
    if (statusEl) {
        if (isAlarm) {
            statusEl.textContent = 'Alerta de Humedad (>65% HR) - Secado Lento';
            statusEl.className = 'font-bold text-rose-600';
        } else {
            statusEl.textContent = `Secado Activo (${scadaState.curingProgress}% - Lote ${batchSize} uds)`;
            statusEl.className = 'font-bold text-emerald-600';
        }
    }
}

// =====================================================================================
// RENDERIZADO DINÁMICO DE TODAS LAS TABLAS Y SELECTORES
// =====================================================================================

function renderAll() {
    computeAndRenderKPIs();
    renderCatalog();
    renderBomMatrix();
    renderBomModalTree();
    renderPO();
    renderMO();
    renderSales();
    renderLots();
    renderQuality();
    populateMaterialSelect();
    populateMoProductSelect();
    populateSalesLotSelect();
    populateQualityLotSelect();
    populateParentBomSelect();
}

function renderBomMatrix() {
    const tbody = document.getElementById('bom-matrix-body');
    if (!tbody) return;

    const batchSize = Number(state.batchSize || 5);
    const colHeaderLot = document.getElementById('bom-col-lot-header');
    if (colHeaderLot) colHeaderLot.textContent = `Cant. por Lote (${batchSize} u.)`;

    const getProd = (id) => state.products.find(p => p.id === id);
    const prodDual = getProd('PROD-DUAL');
    if (!prodDual) {
        tbody.innerHTML = '<tr><td colspan="9" class="py-4 text-center text-slate-400">Cargando estructura BOM desde MySQL...</td></tr>';
        return;
    }

    const rows = [
        {
            level: 'Nivel 0', sku: prodDual.id, name: prodDual.name, parent: '— (Raíz)',
            qty: 1.00, unit: prodDual.unit || 'ud', unitCost: prodDual.stdCost,
            subStd: prodDual.stdCost, lotStr: `${batchSize.toFixed(2)} ${prodDual.unit || 'ud'}`,
            rowClass: 'bg-indigo-50/60 font-bold text-slate-900', skuClass: 'text-indigo-700', indent: false
        }
    ];

    // Recorrer dinámicamente todos los hijos de Nivel 1 y sus hijos de Nivel 2 (incluyendo cualquier producto nuevo agregado)
    const level1List = state.boms['PROD-DUAL'] || [];
    const subSummaries = [];

    level1List.forEach(l1 => {
        const subProd = getProd(l1.componentId);
        if (!subProd) return;
        const subTotalUnit = Number((l1.qtyPerUnit * subProd.stdCost).toFixed(2));
        subSummaries.push(`${subProd.id} [C$ ${subTotalUnit.toFixed(2)}]`);

        rows.push({
            level: 'Nivel 1', sku: subProd.id, name: subProd.name, parent: 'PROD-DUAL',
            qty: l1.qtyPerUnit, unit: subProd.unit || 'Subensamble', unitCost: subProd.stdCost,
            subStd: subTotalUnit, lotStr: `${(l1.qtyPerUnit * batchSize).toFixed(2)} ${subProd.unit || 'ud'}`,
            rowClass: 'bg-emerald-50/50 font-semibold text-slate-800', skuClass: 'text-emerald-700', indent: false
        });

        const level2List = state.boms[subProd.id] || [];
        level2List.forEach(l2 => {
            const mpProd = getProd(l2.componentId);
            if (!mpProd) return;
            const mpSubStd = Number((l2.qtyPerUnit * mpProd.stdCost).toFixed(2));
            rows.push({
                level: 'Nivel 2', sku: mpProd.id, name: mpProd.name, parent: subProd.id,
                qty: l2.qtyPerUnit, unit: mpProd.unit || 'ud', unitCost: mpProd.stdCost,
                subStd: mpSubStd, lotStr: `${(l2.qtyPerUnit * l1.qtyPerUnit * batchSize).toFixed(2)} ${mpProd.unit || 'ud'}`,
                rowClass: 'hover:bg-slate-50 text-slate-600', skuClass: 'text-slate-700', indent: true
            });
        });
    });

    let html = '';
    rows.forEach(r => {
        html += `
            <tr class="${r.rowClass}">
                <td class="py-2 px-3 ${r.indent ? 'pl-6' : ''}">${r.level}</td>
                <td class="py-2 px-3 font-mono ${r.skuClass}">${r.sku}</td>
                <td class="py-2 px-3">${r.name}</td>
                <td class="py-2 px-3 font-mono text-indigo-600">${r.parent}</td>
                <td class="py-2 px-3 text-right font-mono">${Number(r.qty).toFixed(2)}</td>
                <td class="py-2 px-3">${r.unit}</td>
                <td class="py-2 px-3 text-right font-mono">C$ ${Number(r.unitCost).toFixed(2)}</td>
                <td class="py-2 px-3 text-right font-mono">C$ ${Number(r.subStd).toFixed(2)}</td>
                <td class="py-2 px-3 text-right font-mono font-semibold">${r.lotStr}</td>
            </tr>
        `;
    });

    const batchStd = Number((prodDual.stdCost * batchSize).toFixed(2));
    const batchReal = Number((prodDual.realCost * batchSize).toFixed(2));
    const diffUnit = Number((prodDual.realCost - prodDual.stdCost).toFixed(2));
    const diffPct = prodDual.stdCost > 0 ? (((prodDual.realCost - prodDual.stdCost) / prodDual.stdCost) * 100).toFixed(2) : '0.00';

    html += `
        <tr class="bg-slate-100 font-bold text-slate-900 border-t-2 border-slate-300">
            <td colspan="7" class="py-2.5 px-3">COSTO ESTÁNDAR TOTAL DE MATERIALES (${subSummaries.join(' + ')})</td>
            <td class="py-2.5 px-3 text-right font-mono text-indigo-700">C$ ${prodDual.stdCost.toFixed(2)} / ud</td>
            <td class="py-2.5 px-3 text-right font-mono text-indigo-900">C$ ${batchStd.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (Lote ${batchSize})</td>
        </tr>
        <tr class="bg-emerald-50 font-bold text-emerald-900">
            <td colspan="7" class="py-2.5 px-3">COSTO REAL EJECUTADO PROMEDIO (Desviación: ${diffUnit >= 0 ? '+' : ''}C$ ${diffUnit.toFixed(2)}/ud | ${diffPct}%)</td>
            <td class="py-2.5 px-3 text-right font-mono text-emerald-700">C$ ${prodDual.realCost.toFixed(2)} / ud</td>
            <td class="py-2.5 px-3 text-right font-mono text-emerald-900">C$ ${batchReal.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} (Lote ${batchSize})</td>
        </tr>
    `;

    tbody.innerHTML = html;
}

function renderBomModalTree() {
    const container = document.getElementById('bom-modal-dynamic-tree');
    if (!container) return;
    const batchSize = Number(state.batchSize || 5);
    const getProd = (id) => state.products.find(p => p.id === id);
    const prodDual = getProd('PROD-DUAL');
    if (!prodDual) return;

    let html = `
        <div class="p-3 bg-slate-100 rounded-lg font-bold text-slate-800 border border-slate-300 flex items-center justify-between">
            <span><i class="fa-solid fa-box text-indigo-600 mr-2"></i> [${prodDual.id}] ${prodDual.name}</span>
            <span class="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded">Lote de ${batchSize} uds | C$ ${prodDual.stdCost.toFixed(2)} / ud</span>
        </div>
        <div class="pl-6 space-y-2 border-l-2 border-indigo-200 mt-2">
    `;

    (state.boms['PROD-DUAL'] || []).forEach(l1 => {
        const sub = getProd(l1.componentId);
        if (!sub) return;
        html += `
            <div class="p-2.5 bg-emerald-50 rounded border border-emerald-200 text-xs font-semibold text-emerald-900 flex justify-between">
                <span>├─ [${sub.id}] ${sub.name} (x${l1.qtyPerUnit}/ud)</span>
                <span class="text-emerald-700 font-bold">Subtotal: C$ ${(sub.stdCost * l1.qtyPerUnit).toFixed(2)} / ud</span>
            </div>
            <div class="pl-4 text-xs text-slate-600 space-y-1">
        `;
        (state.boms[sub.id] || []).forEach(l2 => {
            const mp = getProd(l2.componentId);
            if (!mp) return;
            html += `<div>└─ [${mp.id}] ${mp.name} (${l2.qtyPerUnit} ${mp.unit || 'ud'} × C$ ${mp.stdCost.toFixed(2)} = C$ ${(l2.qtyPerUnit * mp.stdCost).toFixed(2)})</div>`;
        });
        html += `</div>`;
    });

    html += `</div>`;
    container.innerHTML = html;
}

function renderCatalog() {
    const tbody = document.getElementById('product-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.products.forEach(p => {
        let badgeClass = p.type === 'FINISHED_GOOD'
            ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
            : (p.type === 'SUBASSEMBLY' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200');
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 px-4 font-mono text-xs font-semibold text-slate-600">${p.id} <span class="text-slate-400">(${p.code})</span></td>
                <td class="py-3 px-4 font-medium text-slate-900">${p.name}</td>
                <td class="py-3 px-4"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeClass}">${p.type}</span></td>
                <td class="py-3 px-4 text-right font-mono text-xs text-slate-700">C$ ${Number(p.stdCost || 0).toFixed(2)}</td>
                <td class="py-3 px-4 text-right font-mono text-xs font-semibold text-emerald-700">C$ ${Number(p.realCost || 0).toFixed(2)}</td>
                <td class="py-3 px-4 text-center font-bold ${p.stock <= 0 ? 'text-rose-600' : 'text-slate-800'}">${p.stock} ${p.unit || 'ud'}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    <button onclick="openStockModal('${p.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded border border-slate-300">
                        <i class="fa-solid fa-pen-to-square mr-1"></i>Ajustar
                    </button>
                    ${!((state.boms[p.id] || []).length || Object.values(state.boms).flat().some(b => b.componentId === p.id) || state.lots.some(l => l.productId === p.id) || state.purchaseOrders.some(o => o.materialId === p.id) || state.manufacturingOrders.some(o => o.productId === p.id) || state.salesOrders.some(o => o.productId === p.id)) ? `<button onclick="deleteProduct('${p.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    });
}

function renderPO() {
    const tbody = document.getElementById('po-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.purchaseOrders.forEach(po => {
        let statusBadge = po.status === 'RECIBIDO'
            ? '<span class="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-medium"><i class="fa-solid fa-check mr-1"></i>RECIBIDO</span>'
            : '<span class="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full text-xs font-medium">PENDIENTE</span>';
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-semibold text-indigo-600 text-xs">${po.id}</td>
                <td class="py-3 px-4 text-slate-800 font-medium">${po.supplier}</td>
                <td class="py-3 px-4 text-slate-600">${po.materialName}</td>
                <td class="py-3 px-4 text-center font-bold">${po.qty}</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-500">${po.whin}</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    ${po.status === 'PENDIENTE' ? `<button onclick="receivePO('${po.id}')" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1 rounded shadow"><i class="fa-solid fa-boxes-packing mr-1"></i>Recibir (WH/IN)</button>` : '<span class="text-xs text-slate-400">Completado</span>'}
                    ${po.status === 'PENDIENTE' ? `<button onclick="deletePO('${po.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    });
}

function renderMO() {
    const tbody = document.getElementById('mo-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.manufacturingOrders.forEach(mo => {
        let statusBadge = mo.status === 'HECHO'
            ? '<span class="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">HECHO</span>'
            : '<span class="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">CONFIRMADO</span>';
        let compBadge = mo.componentStatus === 'DISPONIBLE'
            ? '<span class="text-emerald-600 font-medium text-xs"><i class="fa-solid fa-circle-check mr-1"></i>Disponible</span>'
            : '<span class="text-rose-600 font-medium text-xs"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Stock Insuficiente</span>';
        const recipe = state.boms[mo.productId] || [];
        const recipeSummary = recipe.map(r => `${r.componentId} (${(r.qtyPerUnit * mo.qty).toFixed(2)})`).join(', ');
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-bold text-indigo-700 text-xs">${mo.id}</td>
                <td class="py-3 px-4">
                    <div class="font-medium text-slate-900">${mo.productName}</div>
                    <div class="text-[11px] text-slate-500">Descuenta BOM: ${recipeSummary || 'Insumo directo'}</div>
                </td>
                <td class="py-3 px-4 text-center font-bold">${mo.qty} uds</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-600">${mo.lotCode || 'Pendiente'}</td>
                <td class="py-3 px-4 text-center">${compBadge}</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    ${mo.status !== 'HECHO' ? `<button onclick="executeMO('${mo.id}')" class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1 rounded shadow"><i class="fa-solid fa-play mr-1"></i>Producir</button>` : '<span class="text-xs text-slate-400">Finalizada</span>'}
                    ${mo.status === 'CONFIRMADO' ? `<button onclick="deleteMO('${mo.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            </tr>
        `;
    });
}

function renderSales() {
    const tbody = document.getElementById('so-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    (state.salesOrders || []).forEach(so => {
        let badge = so.status === 'DESPACHADO'
            ? '<span class="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-semibold"><i class="fa-solid fa-truck-fast mr-1"></i>DESPACHADO</span>'
            : '<span class="bg-amber-100 text-amber-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">RESERVADO</span>';
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-bold text-indigo-700 text-xs">${so.id}</td>
                <td class="py-3 px-4 font-medium text-slate-800">${so.customerName}</td>
                <td class="py-3 px-4 text-slate-700">${so.productName}</td>
                <td class="py-3 px-4 font-mono text-xs text-emerald-700 font-semibold">${so.lotCode}</td>
                <td class="py-3 px-4 text-center font-bold">${so.qty} uds</td>
                <td class="py-3 px-4 text-right font-mono text-xs font-bold text-slate-900">C$ ${Number(so.totalAmount).toFixed(2)}</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-500">${so.whout}</td>
                <td class="py-3 px-4 text-center">${badge}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    <button onclick="printSale('${so.id}')" class="text-xs bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded"><i class="fa-solid fa-print mr-1"></i>Comprobante</button>

                </td>
            </tr>
        `;
    });
}

function renderLots() {
    const tbody = document.getElementById('lots-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.lots.forEach(lot => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-bold text-emerald-700 text-xs">${lot.lotNumber}</td>
                <td class="py-3 px-4 font-medium text-slate-800">${lot.productName}</td>
                <td class="py-3 px-4 text-center font-bold">${lot.qty}</td>
                <td class="py-3 px-4 font-mono text-xs text-indigo-600">${lot.sourceDoc}</td>
                <td class="py-3 px-4 text-xs text-slate-500">${lot.timestamp}</td>
                <td class="py-3 px-4 text-right"><span class="text-xs text-slate-400"><i class="fa-solid fa-lock mr-1"></i>Histórico</span></td>
            </tr>
        `;
    });
}

function renderQuality() {
    const tbody = document.getElementById('quality-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.qualityInspections.forEach(qi => {
        const inspected = qi.inspectedQty || 5;
        const okFirst = qi.okFirstPass !== undefined ? qi.okFirstPass : 4;
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono text-xs text-indigo-600 font-semibold">${qi.id}</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-600">${qi.lot}</td>
                <td class="py-3 px-4 text-center font-mono text-xs font-bold text-slate-700">${okFirst} / ${inspected} OK</td>
                <td class="py-3 px-4 text-slate-800">${qi.defect}</td>
                <td class="py-3 px-4 text-center"><span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs">${qi.classification}</span></td>
                <td class="py-3 px-4 font-semibold text-emerald-600 text-xs">${qi.disposition}</td>
                <td class="py-3 px-4 text-right"><span class="text-xs text-slate-400"><i class="fa-solid fa-check-circle mr-1"></i>Registrada</span></td>
            </tr>
        `;
    });
}

function populateMaterialSelect() {
    const select = document.getElementById('po-material');
    if (!select) return;
    select.innerHTML = '';
    const rawMaterials = state.products.filter(p => p.type === 'RAW_MATERIAL');
    rawMaterials.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.id} - Stock: ${m.stock} ${m.unit || 'ud'})</option>`;
    });
}

function populateMoProductSelect() {
    const select = document.getElementById('mo-product');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    const manufacturable = state.products.filter(p => p.type === 'FINISHED_GOOD' || p.type === 'SUBASSEMBLY');
    manufacturable.forEach(p => {
        const tag = p.type === 'FINISHED_GOOD' ? 'Producto Terminado' : 'Subensamble';
        select.innerHTML += `<option value="${p.id}">${p.id}: ${p.name} (${tag})</option>`;
    });
    if (prev && manufacturable.some(x => x.id === prev)) select.value = prev;
}

function populateParentBomSelect() {
    const select = document.getElementById('prod-parent-bom');
    if (!select) return;
    select.innerHTML = '<option value="NONE">Independiente (No vincular a BOM todavía)</option>';
    const parents = state.products.filter(p => p.type === 'FINISHED_GOOD' || p.type === 'SUBASSEMBLY');
    parents.forEach(p => {
        select.innerHTML += `<option value="${p.id}">Hijo de [${p.id}] ${p.name}</option>`;
    });
}

function populateSalesLotSelect() {
    const select = document.getElementById('so-lot');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    const lots = state.lots.filter(l => l.productId === 'PROD-DUAL');
    lots.forEach(l => {
        const qc = state.qualityInspections.find(q => q.lot === l.lotNumber);
        if (!qc || qc.scrapQty > 0) return;
        const alreadySold = state.salesOrders
            .filter(so => so.lotCode === l.lotNumber && so.status === 'DESPACHADO')
            .reduce((sum, so) => sum + Number(so.qty), 0);
        const qualityOk = Number(qc.okFirstPass) + Number(qc.reworkedQty);
        const available = Math.max(0, Math.min(Number(l.qty), qualityOk) - alreadySold);
        if (available >= 1) {
            select.innerHTML += `<option value="${escapeHTML(l.lotNumber)}">${escapeHTML(l.lotNumber)} (${available} uds liberadas)</option>`;
        }
    });
    if (!select.innerHTML) {
        select.innerHTML = '<option value="" disabled selected>Produzca un lote y registre su inspección de calidad</option>';
    } else if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
}

function syncQualityQuantity() {
    const selected = document.getElementById('qc-lot')?.value;
    const mo = state.manufacturingOrders.find(m => m.lotCode === selected);
    const qtyInput = document.getElementById('qc-inspected-qty');
    if (mo && qtyInput) { qtyInput.value = mo.qty; qtyInput.max = mo.qty; }
}

function populateQualityLotSelect() {
    const select = document.getElementById('qc-lot');
    if (!select) return;
    const prev = select.value;
    select.innerHTML = '';
    state.manufacturingOrders
        .filter(m => m.status === 'HECHO' && m.productId === 'PROD-DUAL'
          && !state.qualityInspections.some(q => q.lot === m.lotCode))
        .forEach(m => {
            select.innerHTML += `<option value="${escapeHTML(m.lotCode)}">${escapeHTML(m.lotCode)} — ${m.qty} unidades</option>`;
        });
    if (!select.innerHTML) {
        select.innerHTML = '<option value="" disabled selected>Primero fabrique un nuevo lote sin inspección</option>';
    } else if (prev && [...select.options].some(o => o.value === prev)) select.value = prev;
    syncQualityQuantity();
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('text-indigo-600', 'bg-indigo-50', 'border', 'border-indigo-200');
        btn.classList.add('text-slate-600');
    });
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.remove('hidden');
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    if (activeBtn) {
        activeBtn.classList.add('text-indigo-600', 'bg-indigo-50', 'border', 'border-indigo-200');
        activeBtn.classList.remove('text-slate-600');
    }
}

// =====================================================================================
// OPERACIONES CRUD ENVIADAS DIRECTAMENTE A MYSQL (API.PHP)
// =====================================================================================

async function submitNewProduct(e) {
    e.preventDefault();
    const code = document.getElementById('prod-code').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const type = document.getElementById('prod-type').value;
    const unit = document.getElementById('prod-unit') ? document.getElementById('prod-unit').value.trim() : 'ud';
    const stdCost = parseFloat(document.getElementById('prod-cost').value) || 0;
    const stock = parseFloat(document.getElementById('prod-stock').value) || 0;
    const parentBom = document.getElementById('prod-parent-bom') ? document.getElementById('prod-parent-bom').value : 'NONE';
    const qtyPerParent = document.getElementById('prod-bom-qty') ? (parseFloat(document.getElementById('prod-bom-qty').value) || 1) : 1;
    const id = code.toUpperCase().replace(/\s+/g, '-');

    const ok = await apiRequest('create_product', {
        id, code, name, type, unit, stdCost, realCost: stdCost, stock, parentBom, qtyPerParent
    });
    if (ok) {
        document.getElementById('form-create-product').reset();
        closeModal('modal-create-product');
        showToast(`"${name}" guardado en MySQL e integrado a la estructura BOM.`, 'success');
    }
}

async function saveStockAdjustment(e) {
    e.preventDefault();
    const id = document.getElementById('stock-adjust-id').value;
    const stock = parseFloat(document.getElementById('stock-adjust-qty').value);
    const stdCost = parseFloat(document.getElementById('stock-adjust-std-cost').value);
    const realCost = parseFloat(document.getElementById('stock-adjust-real-cost').value);

    const ok = await apiRequest('update_product', { id, stock, stdCost, realCost });
    if (ok) {
        closeModal('modal-edit-stock');
        showToast('Producto actualizado en MySQL y matriz de costos recalculada.', 'success');
    }
}

async function submitNewPO(e) {
    e.preventDefault();
    const supplier = document.getElementById('po-supplier').value;
    const supplierId = ({'Maderas y Muebles S.A.':1, 'Ferretería Industrial Managua S.A.':2, 'Recubrimientos y Barnices Centroamericanos':3, 'Empaques Corrugados Kraft Nic':4})[supplier] || Number(supplier) || 1;
    const materialId = document.getElementById('po-material').value;
    const qty = Number(document.getElementById('po-qty').value);
    if (!Number.isFinite(qty) || qty <= 0) { showToast('La compra requiere una cantidad positiva.', 'error'); return; }
    const material = state.products.find(p => p.id === materialId);
    if (!material) return;
    const poId = nextNumericId(state.purchaseOrders, 'PO');
    const whin = `WH/IN/${poId.slice(2)}`;

    const ok = await apiRequest('create_po', {
        id: poId, supplierId, materialId, qty, unitCost: material.stdCost, whin
    });
    if (ok) {
        document.getElementById('form-create-po').reset();
        closeModal('modal-create-po');
        showToast(`Orden de compra ${poId} guardada en MySQL.`, 'success');
    }
}

async function receivePO(poId) {
    const lotNumber = nextNumericId(state.lots, 'LOT-WHIN-', 5, 'lotNumber');
    const ok = await apiRequest('receive_po', { id: poId, lotNumber });
    if (ok) showToast(`Recepción completada en MySQL. Lote creado: ${lotNumber}`, 'success');
}

async function submitNewMO(e) {
    e.preventDefault();
    const productId = document.getElementById('mo-product').value;
    const qty = Number(document.getElementById('mo-qty').value);
    if (!Number.isInteger(qty) || qty < 1) { showToast('La fabricación requiere una cantidad entera positiva.', 'error'); return; }
    const product = state.products.find(p => p.id === productId);
    if (!product) return;

    const moId = nextNumericId(state.manufacturingOrders, 'WH/MO/');
    const lotCode = `LOT-MO-${moId.split('/').pop()}`;

    const recipe = state.boms[productId] || [];
    let hasAll = true;
    recipe.forEach(item => {
        const comp = state.products.find(p => p.id === item.componentId);
        if (!comp || comp.stock < item.qtyPerUnit * qty) hasAll = false;
    });

    const ok = await apiRequest('create_mo', {
        id: moId,
        productId,
        qty,
        lotCode,
        plannedMin: Math.round(qty * 110),
        realOperatingMin: Math.round(qty * 99),
        batchStdCost: Number((product.stdCost * qty).toFixed(2)),
        batchRealCost: Number((product.realCost * qty).toFixed(2)),
        componentStatus: hasAll ? 'DISPONIBLE' : 'INSUFICIENTE'
    });
    if (ok) {
        closeModal('modal-create-mo');
        showToast(`Orden de producción ${moId} (${qty} uds) registrada en MySQL.`, 'success');
    }
}

async function executeMO(moId) {
    const mo = state.manufacturingOrders.find(m => m.id === moId);
    if (!mo || mo.status === 'HECHO') return;

    const recipe = state.boms[mo.productId] || [];
    const missing = [];
    recipe.forEach(item => {
        const comp = state.products.find(p => p.id === item.componentId);
        const reqQty = Number((item.qtyPerUnit * mo.qty).toFixed(2));
        if (!comp || comp.stock < reqQty) {
            missing.push(`${item.componentId} (Req: ${reqQty}, Disp: ${comp ? comp.stock : 0})`);
        }
    });

    if (missing.length > 0) {
        showToast(`Stock insuficiente para fabricar ${mo.productId}: ${missing.join(' | ')}`, 'error');
        return;
    }

    const ok = await apiRequest('execute_mo', { id: moId });
    if (ok) showToast(`Producción ${moId} completada en MySQL y materiales descontados.`, 'success');
}

async function submitNewSO(e) {
    e.preventDefault();
    const customerId = Number(document.getElementById('so-customer').value);
    const lotCode = document.getElementById('so-lot').value;
    if (!lotCode) { showToast('Primero produzca un lote disponible para despachar.', 'error'); return; }
    const qty = Number(document.getElementById('so-qty').value);
    if (!Number.isInteger(qty) || qty < 1) { showToast('La venta requiere una cantidad entera positiva.', 'error'); return; }
    const prod = state.products.find(p => p.id === 'PROD-DUAL');

    if (!prod || prod.stock < qty) {
        showToast(`Stock insuficiente de ECOLIFT DUAL. Disponible: ${prod ? prod.stock : 0} uds.`, 'error');
        return;
    }

    const soId = nextNumericId(state.salesOrders, 'SO');
    const whout = `WH/OUT/${soId.slice(2)}`;
    const unitPrice = prod.salePrice || 950.00;
    const totalAmount = Number((qty * unitPrice).toFixed(2));

    const ok = await apiRequest('create_so', {
        id: soId, customerId, productId: 'PROD-DUAL', lotCode, qty, unitPrice, totalAmount, whout
    });
    if (ok) {
        closeModal('modal-create-so');
        showToast(`Venta ${soId} y Despacho ${whout} registrados en MySQL.`, 'success');
    }
}

async function submitQualityInspection(e) {
    e.preventDefault();
    const lot = document.getElementById('qc-lot').value.trim();
    if (!lot) { showToast('No hay lotes pendientes de inspección. Fabrique uno en Manufactura.', 'error'); return; }
    const inspectedQty = parseInt(document.getElementById('qc-inspected-qty').value, 10) || 5;
    const reworkedQty = parseInt(document.getElementById('qc-reworked-qty').value, 10) || 0;
    const defect = document.getElementById('qc-defect').value.trim() || 'Sin defectos detectados';
    const disposition = document.getElementById('qc-disposition').value;
    const isScrap = disposition.toLowerCase().includes('desecho') || disposition.toLowerCase().includes('scrap');
    const scrapQty = isScrap ? reworkedQty : 0;
    const actualRework = isScrap ? 0 : reworkedQty;
    const okFirstPass = Math.max(0, inspectedQty - reworkedQty);
    const insId = nextNumericId(state.qualityInspections, 'INS-', 3);

    const ok = await apiRequest('create_qc', {
        id: insId, lot, inspectedQty, okFirstPass, reworkedQty: actualRework, scrapQty, defect, disposition
    });
    if (ok) {
        document.getElementById('form-quality-check').reset();
        closeModal('modal-quality-check');
        showToast(`Inspección ${insId} guardada en MySQL y KPIs actualizados.`, 'success');
    }
}

async function deleteProduct(id) { if (confirm(`¿Eliminar el producto ${id}?`)) await apiRequest('delete_product', { id }); }
async function deletePO(id) { if (confirm(`¿Eliminar la compra pendiente ${id}?`)) await apiRequest('delete_po', { id }); }
async function deleteMO(id) { if (confirm(`¿Eliminar la fabricación pendiente ${id}?`)) await apiRequest('delete_mo', { id }); }
async function deleteSO(id) { await apiRequest('delete_so', { id }); }
async function deleteLot(lotNumber) { await apiRequest('delete_lot', { lotNumber }); }
async function deleteQualityInspection(id) { await apiRequest('delete_qc', { id }); }

function printSale(id) {
    const so = state.salesOrders.find(item => item.id === id);
    if (!so) { showToast('No se encontró la venta.', 'error'); return; }
    const w = window.open('', '_blank', 'width=760,height=850');
    if (!w) { showToast('Habilite las ventanas emergentes para imprimir el comprobante.', 'error'); return; }
    const money = n => `C$ ${Number(n).toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2})}`;
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante ${escapeHTML(so.id)}</title>
    <style>body{font-family:Arial,sans-serif;color:#172438;max-width:690px;margin:35px auto;padding:15px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #079669;padding-bottom:15px}h1{font-size:24px;margin:0;color:#065f46}.muted{color:#64748b;font-size:13px}.panel{background:#f1f5f9;padding:15px;border-radius:9px;margin:20px 0}table{width:100%;border-collapse:collapse;margin-top:25px}td,th{padding:13px;border-bottom:1px solid #ddd;text-align:left}th{background:#ecfdf5}.total{text-align:right;font-size:22px;font-weight:700;margin-top:23px}.footer{margin-top:55px;font-size:12px;color:#64748b}.no-print{margin:15px 0;padding:11px;background:#059669;color:white;border:0;border-radius:6px;cursor:pointer}@media print{.no-print{display:none}}</style></head>
    <body><header><div><h1>ECOLIFT ERP</h1><div class="muted">Comprobante de venta y despacho • Demo académica</div></div><div><strong>${escapeHTML(so.id)}</strong><div class="muted">${escapeHTML(so.timestamp || '')}</div></div></header>
    <div class="panel"><strong>Cliente:</strong> ${escapeHTML(so.customerName)}<p><strong>Documento de salida:</strong> ${escapeHTML(so.whout)}<br><strong>Lote:</strong> ${escapeHTML(so.lotCode)}</p></div>
    <table><thead><tr><th>Producto</th><th>Cant.</th><th>P. unitario</th><th>Subtotal</th></tr></thead><tbody><tr><td>${escapeHTML(so.productName)}</td><td>${so.qty}</td><td>${money(so.unitPrice)}</td><td>${money(so.totalAmount)}</td></tr></tbody></table>
    <div class="total">Total: ${money(so.totalAmount)}</div><div class="footer">Documento generado desde datos almacenados en MySQL. Este comprobante no sustituye una factura fiscal autorizada.</div>
    <button class="no-print" onclick="window.print()">Imprimir o guardar PDF</button></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
}

function openStockModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    document.getElementById('stock-adjust-id').value = product.id;
    document.getElementById('stock-adjust-name').value = product.name;
    document.getElementById('stock-adjust-qty').value = product.stock;
    document.getElementById('stock-adjust-std-cost').value = product.stdCost || 0;
    document.getElementById('stock-adjust-real-cost').value = product.realCost || 0;
    openModal('modal-edit-stock');
}

function openModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    let bg = type === 'success' ? 'bg-emerald-600 text-white' : (type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white');
    toast.className = `${bg} px-4 py-3 rounded-lg shadow-lg text-xs font-medium flex items-center space-x-2`;
    toast.innerHTML = '<i class="fa-solid fa-circle-info"></i><span></span>';
    toast.querySelector('span').textContent = String(msg);
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

window.onload = function() {
    if (window.location.protocol === 'file:') {
        const hrefDec = decodeURIComponent(window.location.href).replace(/\\/g, '/');
        const match = hrefDec.match(/htdocs\/(.+)$/i);
        if (match && match[1]) {
            window.location.replace('http://localhost/' + match[1]);
            return;
        }
    }
    apiRequest('get_state');
    startScadaSimulator();
};
