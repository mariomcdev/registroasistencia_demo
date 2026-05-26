// ============================================================
// CONFIGURACIÓN DE SUPABASE
// ============================================================
const SUPABASE_URL = 'https://zvxawcnluuasmtspqykj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eGF3Y25sdXVhc210c3BxeWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MTA5MDMsImV4cCI6MjA5NTM4NjkwM30.JXi39ANzOdqLAXd3EOMDLb7IK-8oIEvomC5VNYSjX2A';

let supabase = null;
let currentUser = null;
let demoMode = false;
let currentEmployeePage = 1;
const employeesPerPage = 10;

// Estado para reportes
let reportesData = [];
let empleadosList = [];

// Inicializar Supabase
try {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("✅ Supabase cliente inicializado");
    crearTablasSiNoExisten();
} catch (err) {
    console.warn("⚠️ Error creando cliente Supabase, modo demostración local", err);
    demoMode = true;
}

async function crearTablasSiNoExisten() {
    if (demoMode) return;
    try {
        const { error } = await supabase.from('employees').select('count', { count: 'exact', head: true });
        if (error && error.code === '42P01') {
            console.warn("La tabla 'employees' no existe. Por favor, créala en Supabase");
        }
    } catch(e) { console.log("Verificación de tablas:", e); }
}

// ============================================================
// AUTENTICACIÓN
// ============================================================
async function getCurrentSession() {
    if (demoMode || !supabase) return null;
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) return null;
    return session;
}

async function loginWithEmail(email, password) {
    if (demoMode || !supabase) {
        if (email && password && password.length >= 4) {
            currentUser = { email: email, id: 'demo-user', role: 'admin' };
            localStorage.setItem('demoUser', JSON.stringify({ email }));
            return { success: true };
        }
        return { success: false, error: "Credenciales inválidas (demo: mínimo 4 caracteres)" };
    } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { success: false, error: error.message };
        currentUser = data.user;
        return { success: true, user: data.user };
    }
}

async function performLogout() {
    if (!demoMode && supabase) await supabase.auth.signOut();
    currentUser = null;
    localStorage.removeItem('demoUser');
    showLoginScreen();
}

function showLoginScreen() {
    document.getElementById('loginContainer').classList.remove('hidden');
    document.getElementById('appContainer').classList.add('hidden');
    document.getElementById('loginError').classList.add('hidden');
}

function showAppDashboard(userEmail) {
    document.getElementById('loginContainer').classList.add('hidden');
    document.getElementById('appContainer').classList.remove('hidden');
    document.getElementById('userEmailNav').innerText = userEmail || (currentUser?.email || 'usuario@empresa');
    loadModule('dashboard');
    highlightActiveLink('dashboard');
}

// ============================================================
// MÓDULO DE MARCACIÓN
// ============================================================
async function renderMarcacionEmpleado() {
    const employees = await getEmployeesList();
    return `
        <div class="max-w-3xl mx-auto">
            <div class="card-dark p-6 space-y-6">
                <div class="text-center">
                    <i class="fas fa-fingerprint text-5xl text-blue-400"></i>
                    <h2 class="text-2xl font-bold mt-2">Registro de Marcación</h2>
                    <p class="text-gray-400">${new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                </div>
                
                <div class="space-y-4">
                    <div>
                        <label class="block text-sm mb-1">Seleccionar Empleado</label>
                        <select id="empleadoSelect" class="input-dark w-full px-4 py-2 rounded-lg">
                            <option value="">Seleccione un empleado...</option>
                            ${employees.map(emp => `<option value="${emp.id}">${emp.nombre} - ${emp.puesto}</option>`).join('')}
                        </select>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-4">
                        <button id="marcarEntradaBtn" class="bg-emerald-600/20 hover:bg-emerald-600/40 py-3 rounded-xl border border-emerald-500/30">
                            <i class="fas fa-sign-in-alt mr-2"></i> Entrada
                        </button>
                        <button id="marcarSalidaBtn" class="bg-amber-600/20 hover:bg-amber-600/40 py-3 rounded-xl border border-amber-500/30">
                            <i class="fas fa-sign-out-alt mr-2"></i> Salida
                        </button>
                    </div>
                    
                    <div id="marcacionInfo" class="bg-gray-900/40 rounded-lg p-4 space-y-2">
                        <p><i class="far fa-clock mr-2 text-blue-400"></i> <strong>Última entrada:</strong> <span id="ultimaEntrada">--:--</span></p>
                        <p><i class="far fa-clock mr-2 text-amber-400"></i> <strong>Última salida:</strong> <span id="ultimaSalida">--:--</span></p>
                        <p><i class="fas fa-calculator mr-2 text-green-400"></i> <strong>Horas totales:</strong> <span id="horasTotales">0.00</span> hrs</p>
                        <p><i class="fas fa-plus-circle mr-2 text-orange-400"></i> <strong>Horas extras:</strong> <span id="horasExtras">0.00</span> hrs</p>
                    </div>
                </div>
                
                <div class="mt-4">
                    <h3 class="font-semibold mb-2">📋 Historial de hoy</h3>
                    <div id="historialHoy" class="space-y-1 text-sm max-h-60 overflow-y-auto"></div>
                </div>
            </div>
        </div>
    `;
}

async function marcarEntrada(employeeId) {
    if (!employeeId) {
        Swal.fire('Error', 'Seleccione un empleado', 'error');
        return;
    }
    
    const ahora = new Date();
    const horaActual = ahora.toTimeString().slice(0,5);
    
    const { data, error } = await supabase
        .from('registros_marcacion')
        .insert([{
            employee_id: employeeId,
            fecha: ahora.toISOString().split('T')[0],
            hora_entrada: horaActual,
            horas_totales: 0,
            horas_extras: 0
        }]);
    
    if (error) {
        Swal.fire('Error', 'No se pudo registrar la entrada: ' + error.message, 'error');
    } else {
        Swal.fire('Éxito', `Entrada registrada a las ${horaActual}`, 'success');
        actualizarInfoMarcacion(employeeId);
        document.getElementById('ultimaEntrada').innerText = horaActual;
    }
}

async function marcarSalida(employeeId) {
    if (!employeeId) {
        Swal.fire('Error', 'Seleccione un empleado', 'error');
        return;
    }
    
    const hoy = new Date().toISOString().split('T')[0];
    const ahora = new Date();
    const horaSalida = ahora.toTimeString().slice(0,5);
    
    const { data: registros, error: findError } = await supabase
        .from('registros_marcacion')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('fecha', hoy)
        .is('hora_salida', null)
        .order('id', { ascending: false })
        .limit(1);
    
    if (findError || !registros || registros.length === 0) {
        Swal.fire('Error', 'No hay registro de entrada para hoy', 'error');
        return;
    }
    
    const registro = registros[0];
    const horaEntrada = registro.hora_entrada;
    
    const entradaDate = new Date(`2000-01-01T${horaEntrada}:00`);
    const salidaDate = new Date(`2000-01-01T${horaSalida}:00`);
    let horasDiff = (salidaDate - entradaDate) / (1000 * 60 * 60);
    
    let horasExtras = 0;
    if (horasDiff > 8) {
        horasExtras = horasDiff - 8;
    }
    
    const { error: updateError } = await supabase
        .from('registros_marcacion')
        .update({
            hora_salida: horaSalida,
            horas_totales: parseFloat(horasDiff.toFixed(2)),
            horas_extras: parseFloat(horasExtras.toFixed(2))
        })
        .eq('id', registro.id);
    
    if (updateError) {
        Swal.fire('Error', 'No se pudo registrar la salida', 'error');
    } else {
        Swal.fire('Éxito', `Salida registrada a las ${horaSalida}\nHoras totales: ${horasDiff.toFixed(2)}h\nHoras extras: ${horasExtras.toFixed(2)}h`, 'success');
        actualizarInfoMarcacion(employeeId);
        document.getElementById('ultimaSalida').innerText = horaSalida;
        document.getElementById('horasTotales').innerText = horasDiff.toFixed(2);
        document.getElementById('horasExtras').innerText = horasExtras.toFixed(2);
    }
}

async function actualizarInfoMarcacion(employeeId) {
    const hoy = new Date().toISOString().split('T')[0];
    const { data: registros } = await supabase
        .from('registros_marcacion')
        .select('*')
        .eq('employee_id', employeeId)
        .eq('fecha', hoy)
        .order('id', { ascending: false });
    
    if (registros && registros.length > 0) {
        const ultimo = registros[0];
        if (ultimo.hora_entrada) document.getElementById('ultimaEntrada').innerText = ultimo.hora_entrada;
        if (ultimo.hora_salida) document.getElementById('ultimaSalida').innerText = ultimo.hora_salida;
        if (ultimo.horas_totales) document.getElementById('horasTotales').innerText = ultimo.horas_totales;
        if (ultimo.horas_extras) document.getElementById('horasExtras').innerText = ultimo.horas_extras;
        
        const historialDiv = document.getElementById('historialHoy');
        if (historialDiv) {
            historialDiv.innerHTML = registros.map(r => 
                `<div class="border-b border-gray-700 py-1">Entrada: ${r.hora_entrada} | Salida: ${r.hora_salida || '--'} | Total: ${r.horas_totales || 0}h | Extras: ${r.horas_extras || 0}h</div>`
            ).join('');
        }
    }
}

// ============================================================
// CRUD DE EMPLEADOS
// ============================================================
async function getEmployeesList() {
    if (demoMode) {
        return [
            { id: 1, nombre: 'Ana García', email: 'ana@demo.com', puesto: 'Desarrollador', departamento: 'TI' },
            { id: 2, nombre: 'Carlos López', email: 'carlos@demo.com', puesto: 'Analista', departamento: 'Finanzas' },
            { id: 3, nombre: 'María Rodríguez', email: 'maria@demo.com', puesto: 'Gerente', departamento: 'Ventas' }
        ];
    }
    
    const { data, error } = await supabase.from('employees').select('*').order('id');
    if (error) return [];
    return data || [];
}

async function renderUsuariosAdmin() {
    const employees = await getEmployeesList();
    const totalPages = Math.ceil(employees.length / employeesPerPage);
    const start = (currentEmployeePage - 1) * employeesPerPage;
    const paginatedEmps = employees.slice(start, start + employeesPerPage);
    
    return `
        <div class="space-y-5">
            <div class="flex justify-between items-center flex-wrap gap-3">
                <div>
                    <h1 class="text-2xl font-bold">Gestión de Empleados</h1>
                    <p class="text-gray-400 text-sm">CRUD completo - ${employees.length} empleados registrados</p>
                </div>
                <button id="crearEmpleadoBtn" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm flex items-center gap-2">
                    <i class="fas fa-plus"></i> Nuevo Empleado
                </button>
            </div>
            
            <div class="card-dark overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="min-w-full">
                        <thead class="bg-gray-900/60 border-b border-gray-700">
                            <tr><th class="px-4 py-3 text-left text-xs">ID</th><th class="px-4 py-3 text-left text-xs">Nombre</th><th class="px-4 py-3 text-left text-xs">Email</th><th class="px-4 py-3 text-left text-xs">Puesto</th><th class="px-4 py-3 text-left text-xs">Departamento</th><th class="px-4 py-3 text-left text-xs">Acciones</th></tr>
                        </thead>
                        <tbody>
                            ${paginatedEmps.map(emp => `
                                <tr class="border-b border-gray-800 hover:bg-gray-800/30">
                                    <td class="px-4 py-3">${emp.id}</td>
                                    <td class="px-4 py-3 font-medium">${emp.nombre}</td>
                                    <td class="px-4 py-3 text-sm">${emp.email}</td>
                                    <td class="px-4 py-3">${emp.puesto}</td>
                                    <td class="px-4 py-3">${emp.departamento}</td>
                                    <td class="px-4 py-3">
                                        <button onclick="editarEmpleado(${emp.id})" class="text-blue-400 hover:text-blue-300 mr-2"><i class="fas fa-edit"></i></button>
                                        <button onclick="eliminarEmpleado(${emp.id})" class="text-red-400 hover:text-red-300"><i class="fas fa-trash"></i></button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                ${totalPages > 1 ? `<div class="flex justify-center gap-2 p-4">${Array.from({ length: totalPages }, (_, i) => `<button onclick="cambiarPaginaEmpleados(${i + 1})" class="px-3 py-1 rounded ${currentEmployeePage === i + 1 ? 'bg-blue-600' : 'bg-gray-700'}">${i + 1}</button>`).join('')}</div>` : ''}
            </div>
        </div>
    `;
}

// ============================================================
// MÓDULO DE REPORTES CON PDF
// ============================================================
async function renderReportes() {
    empleadosList = await getEmployeesList();
    
    return `
        <div class="space-y-6">
            <div>
                <h1 class="text-2xl font-bold">Reportes de Marcación</h1>
                <p class="text-gray-400">Filtros y exportación a PDF con jsPDF</p>
            </div>
            
            <div class="reportes-filtros">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div>
                        <label class="block text-sm mb-2">📅 Fecha Desde</label>
                        <input type="date" id="fechaDesde" class="input-dark w-full px-3 py-2 rounded-lg">
                    </div>
                    <div>
                        <label class="block text-sm mb-2">📅 Fecha Hasta</label>
                        <input type="date" id="fechaHasta" class="input-dark w-full px-3 py-2 rounded-lg">
                    </div>
                    <div>
                        <label class="block text-sm mb-2">👤 Empleado</label>
                        <select id="filtroEmpleado" class="input-dark w-full px-3 py-2 rounded-lg">
                            <option value="">Todos los empleados</option>
                            ${empleadosList.map(emp => `<option value="${emp.id}">${emp.nombre}</option>`).join('')}
                        </select>
                    </div>
                </div>
                
                <div class="flex gap-3">
                    <button id="aplicarFiltrosBtn" class="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-lg flex items-center gap-2">
                        <i class="fas fa-search"></i> Aplicar Filtros
                    </button>
                    <button id="exportarPdfBtn" class="bg-red-600 hover:bg-red-700 px-5 py-2 rounded-lg flex items-center gap-2">
                        <i class="fas fa-file-pdf"></i> Exportar PDF
                    </button>
                </div>
            </div>
            
            <div id="reportesResultados" class="card-dark p-6">
                <div class="text-center text-gray-400 py-8">
                    <i class="fas fa-chart-line text-4xl mb-2"></i>
                    <p>Seleccione filtros y haga clic en "Aplicar Filtros"</p>
                </div>
            </div>
        </div>
    `;
}

async function cargarReportes() {
    const fechaDesde = document.getElementById('fechaDesde').value;
    const fechaHasta = document.getElementById('fechaHasta').value;
    const empleadoId = document.getElementById('filtroEmpleado').value;
    
    if (!fechaDesde || !fechaHasta) {
        Swal.fire('Advertencia', 'Seleccione ambas fechas para filtrar', 'warning');
        return;
    }
    
    let query = supabase
        .from('registros_marcacion')
        .select(`
            *,
            employees!inner (
                nombre,
                puesto,
                departamento
            )
        `)
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .not('hora_salida', 'is', null);
    
    if (empleadoId) {
        query = query.eq('employee_id', parseInt(empleadoId));
    }
    
    const { data, error } = await query.order('fecha', { ascending: true });
    
    if (error) {
        Swal.fire('Error', 'No se pudieron cargar los reportes', 'error');
        console.error(error);
        return;
    }
    
    reportesData = data || [];
    mostrarTablaReportes();
}

function mostrarTablaReportes() {
    const container = document.getElementById('reportesResultados');
    
    if (reportesData.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <i class="fas fa-inbox text-4xl mb-2"></i>
                <p>No se encontraron registros en el rango de fechas seleccionado</p>
            </div>
        `;
        return;
    }
    
    const totalHorasExtras = reportesData.reduce((sum, r) => sum + (parseFloat(r.horas_extras) || 0), 0);
    const totalDias = reportesData.length;
    
    container.innerHTML = `
        <div class="mb-4 p-3 bg-blue-900/30 rounded-lg flex justify-between items-center">
            <div><strong>📊 Resumen:</strong> Total días: ${totalDias} | Total horas extras: ${totalHorasExtras.toFixed(2)}h</div>
        </div>
        <div class="reportes-tabla">
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Empleado</th>
                        <th>Entrada</th>
                        <th>Salida</th>
                        <th>Horas Totales</th>
                        <th>Horas Extras</th>
                    </tr>
                </thead>
                <tbody>
                    ${reportesData.map(r => `
                        <tr>
                            <td>${r.fecha}</td>
                            <td>${r.employees?.nombre || 'N/A'}</td>
                            <td>${r.hora_entrada}</td>
                            <td>${r.hora_salida}</td>
                            <td>${r.horas_totales}h</td>
                            <td class="text-orange-400">${r.horas_extras}h</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

async function exportarPDF() {
    if (reportesData.length === 0) {
        Swal.fire('Error', 'No hay datos para exportar. Aplique los filtros primero.', 'error');
        return;
    }
    
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    
    // Obtener información del filtro
    const fechaDesde = document.getElementById('fechaDesde').value;
    const fechaHasta = document.getElementById('fechaHasta').value;
    const empleadoSelect = document.getElementById('filtroEmpleado');
    const empleadoNombre = empleadoSelect.options[empleadoSelect.selectedIndex]?.text || 'Todos';
    
    // Encabezado profesional
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, 297, 45, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('NEXUS CORE', 20, 20);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Gestión Empresarial', 20, 30);
    doc.text('Reporte de Marcaciones', 20, 40);
    
    // Información del reporte
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Generado: ${new Date().toLocaleString()}`, 200, 55);
    doc.text(`Período: ${fechaDesde} al ${fechaHasta}`, 20, 55);
    doc.text(`Empleado: ${empleadoNombre}`, 20, 62);
    
    // Calcular totales
    const totalHorasExtras = reportesData.reduce((sum, r) => sum + (parseFloat(r.horas_extras) || 0), 0);
    const totalDias = reportesData.length;
    const totalHorasTrabajadas = reportesData.reduce((sum, r) => sum + (parseFloat(r.horas_totales) || 0), 0);
    
    // Preparar datos para la tabla
    const tableData = reportesData.map(r => [
        r.fecha,
        r.employees?.nombre || 'N/A',
        r.hora_entrada,
        r.hora_salida,
        `${r.horas_totales}h`,
        `${r.horas_extras}h`
    ]);
    
    // Configurar autoTable
    doc.autoTable({
        startY: 70,
        head: [['Fecha', 'Empleado', 'Entrada', 'Salida', 'Horas Totales', 'Horas Extras']],
        body: tableData,
        theme: 'striped',
        headStyles: {
            fillColor: [37, 99, 235],
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center'
        },
        bodyStyles: {
            textColor: 50,
            fontSize: 9
        },
        alternateRowStyles: {
            fillColor: [240, 248, 255]
        },
        margin: { left: 20, right: 20 },
        columnStyles: {
            0: { cellWidth: 30, halign: 'center' },
            1: { cellWidth: 40 },
            2: { cellWidth: 25, halign: 'center' },
            3: { cellWidth: 25, halign: 'center' },
            4: { cellWidth: 30, halign: 'center' },
            5: { cellWidth: 30, halign: 'center' }
        }
    });
    
    const finalY = doc.lastAutoTable.finalY + 10;
    
    // Resumen final con diseño profesional
    doc.setFillColor(240, 248, 255);
    doc.roundedRect(20, finalY, 257, 40, 3, 3, 'F');
    doc.setDrawColor(37, 99, 235);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, finalY, 257, 40, 3, 3, 'D');
    
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('RESUMEN DEL REPORTE', 140, finalY + 10, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`• Total de días trabajados: ${totalDias}`, 35, finalY + 22);
    doc.text(`• Total de horas trabajadas: ${totalHorasTrabajadas.toFixed(2)}h`, 35, finalY + 30);
    doc.text(`• Total de horas extras acumuladas: ${totalHorasExtras.toFixed(2)}h`, 160, finalY + 22);
    doc.text(`• Promedio de horas extras por día: ${(totalHorasExtras / totalDias).toFixed(2)}h`, 160, finalY + 30);
    
    // Pie de página
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Nexus Core Enterprise - Sistema de Gestión de Marcaciones', 148.5, 197, { align: 'center' });
        doc.text(`Página ${i} de ${pageCount}`, 260, 197, { align: 'right' });
    }
    
    // Guardar PDF
    const filename = `reporte_marcaciones_${fechaDesde}_a_${fechaHasta}.pdf`;
    doc.save(filename);
    
    Swal.fire('Éxito', 'PDF generado correctamente', 'success');
}

// ============================================================
// FUNCIONES GLOBALES Y NAVEGACIÓN
// ============================================================
window.editarEmpleado = async (id) => {
    const { data } = await supabase.from('employees').select('*').eq('id', id).single();
    if (data) {
        document.getElementById('modalTitle').innerText = 'Editar Empleado';
        document.getElementById('employeeId').value = data.id;
        document.getElementById('empNombre').value = data.nombre;
        document.getElementById('empEmail').value = data.email;
        document.getElementById('empPuesto').value = data.puesto;
        document.getElementById('empDepto').value = data.departamento;
        document.getElementById('employeeModal').classList.remove('hidden');
        document.getElementById('employeeModal').classList.add('flex');
    }
};

window.eliminarEmpleado = async (id) => {
    const result = await Swal.fire({ title: '¿Eliminar empleado?', icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', confirmButtonText: 'Sí, eliminar' });
    if (!result.isConfirmed) return;
    
    if (demoMode) {
        Swal.fire('Demo', 'Empleado eliminado en modo demo', 'success');
        return;
    }
    
    const { error } = await supabase.from('employees').delete().eq('id', id);
    if (error) Swal.fire('Error', error.message, 'error');
    else { Swal.fire('Eliminado', 'Empleado eliminado correctamente', 'success'); loadModule('usuarios'); }
};

window.cambiarPaginaEmpleados = (page) => { currentEmployeePage = page; loadModule('usuarios'); };

async function loadModule(moduleId) {
    const viewContainer = document.getElementById('dynamicView');
    switch (moduleId) {
        case 'dashboard':
            viewContainer.innerHTML = renderDashboard();
            break;
        case 'usuarios':
            viewContainer.innerHTML = await renderUsuariosAdmin();
            setTimeout(() => {
                document.getElementById('crearEmpleadoBtn')?.addEventListener('click', () => {
                    document.getElementById('modalTitle').innerText = 'Nuevo Empleado';
                    document.getElementById('employeeId').value = '';
                    document.getElementById('empNombre').value = '';
                    document.getElementById('empEmail').value = '';
                    document.getElementById('empPuesto').value = '';
                    document.getElementById('empDepto').value = '';
                    document.getElementById('employeeModal').classList.remove('hidden');
                    document.getElementById('employeeModal').classList.add('flex');
                });
            }, 100);
            break;
        case 'marcacion':
            viewContainer.innerHTML = await renderMarcacionEmpleado();
            setTimeout(() => {
                const empleadoSelect = document.getElementById('empleadoSelect');
                const entradaBtn = document.getElementById('marcarEntradaBtn');
                const salidaBtn = document.getElementById('marcarSalidaBtn');
                if (empleadoSelect) empleadoSelect.onchange = () => { if(empleadoSelect.value) actualizarInfoMarcacion(parseInt(empleadoSelect.value)); };
                if (entradaBtn) entradaBtn.onclick = () => { const id = document.getElementById('empleadoSelect')?.value; if(id) marcarEntrada(parseInt(id)); };
                if (salidaBtn) salidaBtn.onclick = () => { const id = document.getElementById('empleadoSelect')?.value; if(id) marcarSalida(parseInt(id)); };
            }, 100);
            break;
        case 'reportes':
            viewContainer.innerHTML = await renderReportes();
            setTimeout(() => {
                document.getElementById('aplicarFiltrosBtn')?.addEventListener('click', cargarReportes);
                document.getElementById('exportarPdfBtn')?.addEventListener('click', exportarPDF);
            }, 100);
            break;
        default:
            viewContainer.innerHTML = renderDashboard();
    }
    viewContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDashboard() {
    return `
        <div class="space-y-6">
            <div><h1 class="text-2xl md:text-3xl font-bold">Dashboard</h1><p class="text-gray-400">Métricas y actividad reciente</p></div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div class="card-dark p-5"><div class="flex justify-between"><div><p class="text-gray-400">Total empleados</p><p class="text-3xl font-bold" id="totalEmpleados">--</p></div><i class="fas fa-users text-3xl text-blue-500/60"></i></div></div>
                <div class="card-dark p-5"><div class="flex justify-between"><div><p class="text-gray-400">Registros hoy</p><p class="text-3xl font-bold">86</p></div><i class="fas fa-clock text-3xl text-indigo-500/60"></i></div></div>
                <div class="card-dark p-5"><div class="flex justify-between"><div><p class="text-gray-400">Tasa asistencia</p><p class="text-3xl font-bold">94%</p></div><i class="fas fa-chart-line text-3xl text-green-500/60"></i></div></div>
            </div>
        </div>
    `;
}

function highlightActiveLink(moduleId) {
    document.querySelectorAll('.sidebar-link').forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('data-module') === moduleId) link.classList.add('active');
    });
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.classList.remove('bg-blue-600/30', 'text-white');
        if (btn.getAttribute('data-module') === moduleId) btn.classList.add('bg-blue-600/30', 'text-white');
    });
}

function initNavigation() {
    document.querySelectorAll('[data-module]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const module = link.getAttribute('data-module');
            if (module) { loadModule(module); highlightActiveLink(module); }
        });
    });
}

document.getElementById('closeModalBtn')?.addEventListener('click', () => { document.getElementById('employeeModal').classList.add('hidden'); });
document.getElementById('employeeForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('employeeId').value;
    const nombre = document.getElementById('empNombre').value;
    const email = document.getElementById('empEmail').value;
    const puesto = document.getElementById('empPuesto').value;
    const departamento = document.getElementById('empDepto').value;
    
    if (demoMode) {
        Swal.fire('Demo', `Empleado ${id ? 'actualizado' : 'creado'} en modo demo`, 'success');
        document.getElementById('employeeModal').classList.add('hidden');
        loadModule('usuarios');
        return;
    }
    
    if (id) {
        const { error } = await supabase.from('employees').update({ nombre, email, puesto, departamento }).eq('id', parseInt(id));
        if (!error) Swal.fire('Éxito', 'Empleado actualizado', 'success');
    } else {
        const { error } = await supabase.from('employees').insert([{ nombre, email, puesto, departamento }]);
        if (!error) Swal.fire('Éxito', 'Empleado creado', 'success');
    }
    document.getElementById('employeeModal').classList.add('hidden');
    loadModule('usuarios');
});

async function checkAuthState() {
    if (demoMode) {
        const stored = localStorage.getItem('demoUser');
        if (stored) { currentUser = JSON.parse(stored); showAppDashboard(currentUser.email); initNavigation(); loadModule('dashboard'); return; }
        showLoginScreen(); initNavigation(); return;
    }
    const session = await getCurrentSession();
    if (session?.user) { currentUser = session.user; showAppDashboard(session.user.email); initNavigation(); loadModule('dashboard'); }
    else { showLoginScreen(); initNavigation(); }
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const result = await loginWithEmail(email, password);
    if (result.success) { showAppDashboard(email); initNavigation(); loadModule('dashboard'); }
    else { document.getElementById('loginError').innerText = result.error; document.getElementById('loginError').classList.remove('hidden'); }
});

document.getElementById('logoutButton')?.addEventListener('click', performLogout);
checkAuthState();