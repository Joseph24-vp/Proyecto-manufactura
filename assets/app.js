const INITIAL_STATE = {
    products: [
        { id: 'PROD-DUAL', code: 'ECOLIFT DUAL', name: 'ECOLIFT DUAL (Soporte Ergonómico)', type: 'FINISHED_GOOD', route: 'Fabricar este producto', stock: 0 },
        { id: 'SUB-MAD', code: 'SUB-MADERA', name: 'Estructura de Madera Barnizada', type: 'SUBASSEMBLY', route: 'Fabricar este producto', stock: 5 },
        { id: 'SUB-ART', code: 'SUB-ARTICULADO', name: 'Subconjunto Articulado y Herrajes', type: 'SUBASSEMBLY', route: 'Fabricar este producto', stock: 5 },
        { id: 'SUB-EMP', code: 'SUB-EMPAQUE', name: 'Kit de Empaque', type: 'SUBASSEMBLY', route: 'Fabricar este producto', stock: 5 },
        { id: 'MP-MAD', code: 'MP-TABLON', name: 'Tablón de Madera Sólida', type: 'RAW_MATERIAL', route: 'Comprar', stock: 15 },
        { id: 'MP-BAR', code: 'MP-BARNIZ', name: 'Barniz Protector Transparente (L)', type: 'RAW_MATERIAL', route: 'Comprar', stock: 10 },
        { id: 'MP-PAS', code: 'MP-PASADOR', name: 'Pasadores Metálicos de Eje', type: 'RAW_MATERIAL', route: 'Comprar', stock: 25 },
        { id: 'MP-TOP', code: 'MP-TOPES', name: 'Topes de Caucho Antideslizantes', type: 'RAW_MATERIAL', route: 'Comprar', stock: 40 },
        { id: 'MP-TOR', code: 'MP-TORNILLO', name: 'Tornillos de Sujeción Fina', type: 'RAW_MATERIAL', route: 'Comprar', stock: 100 },
        { id: 'MP-CAJ', code: 'MP-CAJA', name: 'Caja de Cartón Reforzada', type: 'RAW_MATERIAL', route: 'Comprar', stock: 12 }
    ],
    purchaseOrders: [
        { id: 'PO00001', supplier: 'Maderas Muebles S.A.', materialId: 'MP-MAD', materialName: 'Tablón de Madera Sólida', qty: 20, whin: 'WH/IN/00001', status: 'RECIBIDO' }
    ],
    manufacturingOrders: [
        { id: 'WH/MO/00001', productId: 'PROD-DUAL', productName: 'ECOLIFT DUAL', qty: 5, lotCode: 'LOT-MO-00001', componentStatus: 'DISPONIBLE', status: 'CONFIRMADO' }
    ],
    lots: [
        { lotNumber: 'LOT-WHIN-00001', productId: 'MP-MAD', productName: 'Tablón de Madera Sólida', qty: 20, sourceDoc: 'WH/IN/00001', timestamp: '2026-11-04 09:30' }
    ],
    qualityInspections: [
        { id: 'INS-001', lot: 'LOT-MO-00001', defect: 'Desalineación en perforación de ejes', classification: 'No Conformidad / Defecto', disposition: 'Retrabajo (Ajuste manual)' }
    ]
};

let state = JSON.parse(localStorage.getItem('ecolift_erp_state')) || JSON.parse(JSON.stringify(INITIAL_STATE));

function saveState() {
    localStorage.setItem('ecolift_erp_state', JSON.stringify(state));
}

function resetData() {
    state = JSON.parse(JSON.stringify(INITIAL_STATE));
    saveState();
    renderAll();
    showToast('Sistema restaurado a valores por defecto.', 'info');
}

function renderAll() {
    renderCatalog();
    renderPO();
    renderMO();
    renderLots();
    renderQuality();
    populateMaterialSelect();
}

function renderCatalog() {
    const tbody = document.getElementById('product-table-body');
    tbody.innerHTML = '';
    state.products.forEach(p => {
        let badgeClass = p.type === 'FINISHED_GOOD' ? 'bg-indigo-100 text-indigo-800 border-indigo-200' : (p.type === 'SUBASSEMBLY' ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-slate-100 text-slate-700 border-slate-200');
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 px-4 font-mono text-xs font-semibold text-slate-600">${p.code}</td>
                <td class="py-3 px-4 font-medium text-slate-900">${p.name}</td>
                <td class="py-3 px-4"><span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${badgeClass}">${p.type}</span></td>
                <td class="py-3 px-4 text-xs text-slate-500">${p.route}</td>
                <td class="py-3 px-4 text-center font-bold text-slate-800">${p.stock}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    <button onclick="openStockModal('${p.id}')" class="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded border border-slate-300">
                        <i class="fa-solid fa-pen-to-square mr-1"></i>Ajustar
                    </button>
                    <button onclick="deleteProduct('${p.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function renderPO() {
    const tbody = document.getElementById('po-table-body');
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
                    ${po.status === 'PENDIENTE' ? `<button onclick="receivePO('${po.id}')" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-3 py-1 rounded shadow"><i class="fa-solid fa-boxes-packing mr-1"></i>Recibir</button>` : '<span class="text-xs text-slate-400">Completado</span>'}
                    <button onclick="deletePO('${po.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function renderMO() {
    const tbody = document.getElementById('mo-table-body');
    tbody.innerHTML = '';
    state.manufacturingOrders.forEach(mo => {
        let statusBadge = mo.status === 'HECHO' ? '<span class="bg-emerald-100 text-emerald-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">HECHO</span>' : '<span class="bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded-full text-xs font-semibold">CONFIRMADO</span>';
        let compBadge = mo.componentStatus === 'DISPONIBLE' ? '<span class="text-emerald-600 font-medium text-xs"><i class="fa-solid fa-circle-check mr-1"></i>Disponible</span>' : '<span class="text-amber-600 font-medium text-xs"><i class="fa-solid fa-triangle-exclamation mr-1"></i>Faltante</span>';
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-bold text-indigo-700 text-xs">${mo.id}</td>
                <td class="py-3 px-4 font-medium text-slate-900">${mo.productName}</td>
                <td class="py-3 px-4 text-center font-bold">${mo.qty} uds</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-600">${mo.lotCode || 'Pendiente'}</td>
                <td class="py-3 px-4 text-center">${compBadge}</td>
                <td class="py-3 px-4 text-center">${statusBadge}</td>
                <td class="py-3 px-4 text-right space-x-1">
                    ${mo.status !== 'HECHO' ? `<button onclick="executeMO('${mo.id}')" class="text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-medium px-3 py-1 rounded shadow"><i class="fa-solid fa-play mr-1"></i>Producir</button>` : '<span class="text-xs text-slate-400">Finalizada</span>'}
                    <button onclick="deleteMO('${mo.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function renderLots() {
    const tbody = document.getElementById('lots-table-body');
    tbody.innerHTML = '';
    state.lots.forEach((lot, index) => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono font-bold text-emerald-700 text-xs">${lot.lotNumber}</td>
                <td class="py-3 px-4 font-medium text-slate-800">${lot.productName}</td>
                <td class="py-3 px-4 text-center font-bold">${lot.qty}</td>
                <td class="py-3 px-4 font-mono text-xs text-indigo-600">${lot.sourceDoc}</td>
                <td class="py-3 px-4 text-xs text-slate-500">${lot.timestamp}</td>
                <td class="py-3 px-4 text-right">
                    <button onclick="deleteLot(${index})" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function renderQuality() {
    const tbody = document.getElementById('quality-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';
    state.qualityInspections.forEach(qi => {
        tbody.innerHTML += `
            <tr class="hover:bg-slate-50">
                <td class="py-3 px-4 font-mono text-xs text-indigo-600">${qi.id}</td>
                <td class="py-3 px-4 font-mono text-xs text-slate-600">${qi.lot}</td>
                <td class="py-3 px-4 text-slate-800">${qi.defect}</td>
                <td class="py-3 px-4 text-center"><span class="bg-amber-100 text-amber-800 px-2 py-0.5 rounded text-xs">${qi.classification}</span></td>
                <td class="py-3 px-4 font-semibold text-emerald-600 text-xs">${qi.disposition}</td>
                <td class="py-3 px-4 text-right">
                    <button onclick="deleteQualityInspection('${qi.id}')" class="text-xs bg-rose-50 hover:bg-rose-100 text-rose-600 font-medium px-2 py-1 rounded border border-rose-200">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>
        `;
    });
}

function populateMaterialSelect() {
    const select = document.getElementById('po-material');
    if (!select) return;
    select.innerHTML = '';
    const rawMaterials = state.products.filter(p => p.type === 'RAW_MATERIAL');
    if (rawMaterials.length === 0) {
        select.innerHTML = '<option value="">No hay materias primas registradas</option>';
        return;
    }
    rawMaterials.forEach(m => {
        select.innerHTML += `<option value="${m.id}">${m.name} (${m.code})</option>`;
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('text-indigo-600', 'bg-indigo-50', 'border', 'border-indigo-200');
        btn.classList.add('text-slate-600');
    });
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    const activeBtn = document.getElementById(`tab-btn-${tabName}`);
    activeBtn.classList.add('text-indigo-600', 'bg-indigo-50', 'border', 'border-indigo-200');
    activeBtn.classList.remove('text-slate-600');
}

function submitNewProduct(e) {
    e.preventDefault();
    const code = document.getElementById('prod-code').value.trim();
    const name = document.getElementById('prod-name').value.trim();
    const type = document.getElementById('prod-type').value;
    const stock = parseFloat(document.getElementById('prod-stock').value);
    const id = `PROD-${Date.now().toString().slice(-5)}`;
    const route = type === 'RAW_MATERIAL' ? 'Comprar' : 'Fabricar este producto';

    state.products.push({ id, code, name, type, route, stock });
    saveState();
    renderAll();
    document.getElementById('form-create-product').reset();
    closeModal('modal-create-product');
    showToast(`Producto o insumo "${name}" agregado correctamente.`, 'success');
}

function saveStockAdjustment(e) {
    e.preventDefault();
    const id = document.getElementById('stock-adjust-id').value;
    const newQty = parseFloat(document.getElementById('stock-adjust-qty').value);
    const product = state.products.find(p => p.id === id);
    if (product) {
        product.stock = newQty;
        saveState();
        renderAll();
        closeModal('modal-edit-stock');
        showToast(`Stock de ${product.name} actualizado a ${newQty}`, 'success');
    }
}

function submitNewPO(e) {
    e.preventDefault();
    const supplier = document.getElementById('po-supplier').value;
    const materialId = document.getElementById('po-material').value;
    const qty = parseFloat(document.getElementById('po-qty').value);
    const material = state.products.find(p => p.id === materialId);
    if (!material) return;
    const poId = `PO${String(state.purchaseOrders.length + 1).padStart(5, '0')}`;
    const whinCode = `WH/IN/${String(state.purchaseOrders.length + 1).padStart(5, '0')}`;

    state.purchaseOrders.unshift({ id: poId, supplier, materialId, materialName: material.name, qty, whin: whinCode, status: 'PENDIENTE' });
    saveState();
    renderAll();
    document.getElementById('form-create-po').reset();
    closeModal('modal-create-po');
    showToast(`Orden ${poId} creada exitosamente.`, 'success');
}

function submitNewMO(e) {
    e.preventDefault();
    const productId = document.getElementById('mo-product').value;
    const qty = parseFloat(document.getElementById('mo-qty').value);
    const product = state.products.find(p => p.id === productId);
    const moId = `WH/MO/${String(state.manufacturingOrders.length + 1).padStart(5, '0')}`;
    const lotCode = `LOT-MO-${String(state.manufacturingOrders.length + 1).padStart(5, '0')}`;

    state.manufacturingOrders.unshift({ id: moId, productId, productName: product.name, qty, lotCode, componentStatus: 'DISPONIBLE', status: 'CONFIRMADO' });
    saveState();
    renderAll();
    document.getElementById('form-create-mo').reset();
    closeModal('modal-create-mo');
    showToast(`Orden de producción ${moId} creada con éxito.`, 'success');
}

function submitQualityInspection(e) {
    e.preventDefault();
    const lot = document.getElementById('qc-lot').value.trim();
    const defect = document.getElementById('qc-defect').value.trim();
    const disposition = document.getElementById('qc-disposition').value;
    const insId = `INS-00${state.qualityInspections.length + 1}`;

    state.qualityInspections.unshift({
        id: insId,
        lot: lot,
        defect: defect,
        classification: 'No Conformidad / Defecto',
        disposition: disposition
    });
    saveState();
    renderAll();
    document.getElementById('form-quality-check').reset();
    closeModal('modal-quality-check');
    showToast(`Inspección de calidad ${insId} registrada exitosamente.`, 'success');
}

function deleteProduct(id) {
    if(confirm('¿Desea eliminar este producto o insumo del catálogo?')) {
        state.products = state.products.filter(p => p.id !== id);
        saveState();
        renderAll();
        showToast('Producto eliminado.', 'info');
    }
}

function deletePO(id) {
    if(confirm('¿Desea eliminar esta Orden de Compra?')) {
        state.purchaseOrders = state.purchaseOrders.filter(p => p.id !== id);
        saveState();
        renderAll();
        showToast('Orden de compra eliminada.', 'info');
    }
}

function deleteMO(id) {
    if(confirm('¿Desea eliminar esta Orden de Fabricación?')) {
        state.manufacturingOrders = state.manufacturingOrders.filter(m => m.id !== id);
        saveState();
        renderAll();
        showToast('Orden de producción eliminada.', 'info');
    }
}

function deleteLot(index) {
    if(confirm('¿Desea eliminar este registro de lote?')) {
        state.lots.splice(index, 1);
        saveState();
        renderAll();
        showToast('Lote eliminado.', 'info');
    }
}

function deleteQualityInspection(id) {
    if(confirm('¿Desea eliminar esta inspección de calidad?')) {
        state.qualityInspections = state.qualityInspections.filter(q => q.id !== id);
        saveState();
        renderAll();
        showToast('Registro de calidad eliminado.', 'info');
    }
}

function receivePO(poId) {
    const po = state.purchaseOrders.find(p => p.id === poId);
    if (!po || po.status === 'RECIBIDO') return;
    po.status = 'RECIBIDO';
    const material = state.products.find(p => p.id === po.materialId);
    if (material) material.stock += po.qty;

    const lotNum = `LOT-WHIN-${Date.now().toString().slice(-5)}`;
    state.lots.unshift({ lotNumber: lotNum, productId: po.materialId, productName: po.materialName, qty: po.qty, sourceDoc: po.whin, timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16) });
    saveState();
    renderAll();
    showToast(`Ingreso almacenado ${po.whin}. Lote generado: ${lotNum}`, 'success');
}

function executeMO(moId) {
    const mo = state.manufacturingOrders.find(m => m.id === moId);
    if (!mo || mo.status === 'HECHO') return;

    if (mo.productId === 'PROD-DUAL') {
        const subMadera = state.products.find(p => p.id === 'SUB-MAD');
        const subArt = state.products.find(p => p.id === 'SUB-ART');
        const subEmp = state.products.find(p => p.id === 'SUB-EMP');

        if (subMadera && subArt && subEmp && (subMadera.stock < mo.qty || subArt.stock < mo.qty || subEmp.stock < mo.qty)) {
            mo.componentStatus = 'INSUFICIENTE';
            saveState();
            renderAll();
            showToast(`Error: Stock insuficiente de subensambles para fabricar el lote.`, 'error');
            return;
        }
        if (subMadera) subMadera.stock -= mo.qty;
        if (subArt) subArt.stock -= mo.qty;
        if (subEmp) subEmp.stock -= mo.qty;
        const prod = state.products.find(p => p.id === 'PROD-DUAL');
        if (prod) prod.stock += mo.qty;
    } else {
        const sub = state.products.find(p => p.id === mo.productId);
        if (sub) sub.stock += mo.qty;
    }

    mo.status = 'HECHO';
    mo.componentStatus = 'DISPONIBLE';
    state.lots.unshift({ lotNumber: mo.lotCode, productId: mo.productId, productName: mo.productName, qty: mo.qty, sourceDoc: mo.id, timestamp: new Date().toISOString().replace('T', ' ').slice(0, 16) });
    saveState();
    renderAll();
    showToast(`¡Fabricación ${mo.id} completada! Lote: ${mo.lotCode}`, 'success');
}

function openStockModal(productId) {
    const product = state.products.find(p => p.id === productId);
    if (!product) return;
    document.getElementById('stock-adjust-id').value = product.id;
    document.getElementById('stock-adjust-name').value = product.name;
    document.getElementById('stock-adjust-qty').value = product.stock;
    openModal('modal-edit-stock');
}

function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    let bg = type === 'success' ? 'bg-emerald-600 text-white' : (type === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-800 text-white');
    toast.className = `${bg} px-4 py-3 rounded-lg shadow-lg text-xs font-medium flex items-center space-x-2`;
    toast.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

window.onload = function() { renderAll(); }