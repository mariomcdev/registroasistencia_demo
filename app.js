// ==================== CONFIGURACIÓN SUPABASE ====================
const SUPABASE_URL = "https://zvxawcnluuasmtspqykj.supabase.co";          // <-- REEMPLAZAR CON TU URL
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp2eGF3Y25sdXVhc210c3BxeWtqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MTA5MDMsImV4cCI6MjA5NTM4NjkwM30.JXi39ANzOdqLAXd3EOMDLb7IK-8oIEvomC5VNYSjX2A";     // <-- REEMPLAZAR CON TU KEY
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentSession = null;
let empleadosList = [];
let asistenciasData = [];

// Elementos DOM
const publicView = document.getElementById('publicView');
const adminLoginView = document.getElementById('adminLoginView');
const adminPanelView = document.getElementById('adminPanelView');
const dniInput = document.getElementById('dniInput');
const btnEntrada = document.getElementById('btnEntrada');
const btnSalida = document.getElementById('btnSalida');
const asistenciasTableBody = document.getElementById('asistenciasTableBody');
const filtroEmpleado = document.getElementById('filtroEmpleado');
const fechaInicio = document.getElementById('fechaInicio');
const fechaFin = document.getElementById('fechaFin');

// ==================== FUNCIONES AUXILIARES ====================
function mostrarAlerta(mensaje, tipo = 'success') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert-toast px-6 py-3 rounded-xl shadow-2xl text-white font-medium flex items-center gap-3 ${tipo === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`;
    alertDiv.innerHTML = `<i class="fas ${tipo === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle'} text-xl"></i><span>${mensaje}</span>`;
    document.body.appendChild(alertDiv);
    setTimeout(() => alertDiv.remove(), 4000);
}

function showView(viewName) {
    publicView.classList.add('hidden');
    adminLoginView.classList.add('hidden');
    adminPanelView.classList.add('hidden');
    if (viewName === 'public') publicView.classList.remove('hidden');
    if (viewName === 'login') adminLoginView.classList.remove('hidden');
    if (viewName === 'admin') adminPanelView.classList.remove('hidden');
}

// ==================== MARCACIÓN DE ENTRADA/SALIDA ====================
async function obtenerEmpleadoPorDNI(dni) {
    if (!dni || dni.trim() === "") { 
        mostrarAlerta("Ingrese un DNI válido", "error"); 
        return null; 
    }
    try {
        const { data, error } = await supabase
            .from('empleados')
            .select('id, dni, nombre, email, area')
            .eq('dni', dni.trim())
            .maybeSingle();
        if (error) throw error;
        if (!data) { 
            mostrarAlerta("DNI no registrado en el sistema", "error"); 
            return null; 
        }
        return data;
    } catch (err) { 
        console.error(err); 
        mostrarAlerta("Error al validar DNI", "error"); 
        return null; 
    }
}

function calcularHorasDecimal(horaInicio, horaFin) {
    const [hInicio, mInicio] = horaInicio.split(':').map(Number);
    const [hFin, mFin] = horaFin.split(':').map(Number);
    let inicioMin = hInicio * 60 + mInicio;
    let finMin = hFin * 60 + mFin;
    if (finMin < inicioMin) finMin += 24 * 60;
    return parseFloat(((finMin - inicioMin) / 60).toFixed(2));
}

async function marcarEntrada() {
    const dni = dniInput.value.trim();
    if (!dni) { 
        mostrarAlerta("Ingrese su DNI", "error"); 
        return; 
    }
    const empleado = await obtenerEmpleadoPorDNI(dni);
    if (!empleado) return;

    const hoy = new Date().toISOString().split('T')[0];
    const horaActual = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    try {
        const { data: registroHoy, error: checkError } = await supabase
            .from('asistencias')
            .select('id, hora_salida')
            .eq('empleado_id', empleado.id)
            .eq('fecha', hoy)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') throw checkError;
        
        if (registroHoy) {
            if (!registroHoy.hora_salida) {
                mostrarAlerta(`⚠️ ${empleado.nombre}, ya tienes una entrada registrada hoy.`, "error");
                return;
            } else {
                mostrarAlerta(`⚠️ ${empleado.nombre}, ya completaste tu jornada.`, "error");
                return;
            }
        }

        const { error: insertError } = await supabase.from('asistencias').insert({
            empleado_id: empleado.id,
            dni: empleado.dni,
            fecha: hoy,
            hora_entrada: horaActual,
            horas_regulares: 0,
            horas_extras: 0
        });
        
        if (insertError) throw insertError;
        mostrarAlerta(`✅ ¡Entrada registrada! Hola ${empleado.nombre} a las ${horaActual}`, "success");
        dniInput.value = '';
    } catch (err) { 
        console.error(err); 
        mostrarAlerta("Error al registrar entrada", "error"); 
    }
}

async function marcarSalida() {
    const dni = dniInput.value.trim();
    if (!dni) { 
        mostrarAlerta("Ingrese su DNI", "error"); 
        return; 
    }
    const empleado = await obtenerEmpleadoPorDNI(dni);
    if (!empleado) return;

    const hoy = new Date().toISOString().split('T')[0];
    const horaSalida = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    try {
        const { data: registro, error: findError } = await supabase
            .from('asistencias')
            .select('id, hora_entrada')
            .eq('empleado_id', empleado.id)
            .eq('fecha', hoy)
            .is('hora_salida', null)
            .maybeSingle();

        if (findError) throw findError;
        
        if (!registro) {
            mostrarAlerta(`⚠️ ${empleado.nombre}, no hay entrada activa para hoy.`, "error");
            return;
        }

        const totalHoras = calcularHorasDecimal(registro.hora_entrada, horaSalida);
        let horasRegulares = totalHoras;
        let horasExtras = 0;
        
        if (totalHoras > 8) { 
            horasRegulares = 8; 
            horasExtras = parseFloat((totalHoras - 8).toFixed(2)); 
        }

        const { error: updateError } = await supabase
            .from('asistencias')
            .update({ 
                hora_salida: horaSalida, 
                horas_regulares: horasRegulares, 
                horas_extras: horasExtras 
            })
            .eq('id', registro.id);
            
        if (updateError) throw updateError;
        mostrarAlerta(`🚪 ¡Salida registrada! ${empleado.nombre}, trabajaste ${totalHoras}h${horasExtras > 0 ? ` (${horasExtras}h extras)` : ''}`, "success");
        dniInput.value = '';
    } catch (err) { 
        console.error(err); 
        mostrarAlerta("Error al registrar salida", "error"); 
    }
}

// ==================== CARGA DE DATOS Y FILTRADO ====================
async function cargarEmpleadosSelect() {
    const { data, error } = await supabase.from('empleados').select('id, dni, nombre').order('nombre');
    if (error) return;
    empleadosList = data || [];
    filtroEmpleado.innerHTML = '<option value="">Todos los empleados</option>' + 
        empleadosList.map(emp => `<option value="${emp.dni}">${emp.dni} - ${emp.nombre}</option>`).join('');
}

async function cargarAsistencias(filters = {}) {
    let query = supabase.from('asistencias').select('*, empleados!inner(nombre, dni)').order('fecha', { ascending: false });
    
    if (filters.dni && filters.dni !== '') {
        query = query.eq('dni', filters.dni);
    }
    if (filters.fechaInicio) {
        query = query.gte('fecha', filters.fechaInicio);
    }
    if (filters.fechaFin) {
        query = query.lte('fecha', filters.fechaFin);
    }

    const { data, error } = await query;
    if (error) { 
        console.error(error); 
        mostrarAlerta("Error al cargar asistencias", "error"); 
        return []; 
    }
    return data || [];
}

async function renderizarTablaAsistencias(filters = {}) {
    asistenciasTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8"><i class="fas fa-spinner fa-spin"></i> Cargando...</td></tr>';
    const data = await cargarAsistencias(filters);
    asistenciasData = data;
    
    if (data.length === 0) {
        asistenciasTableBody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">No hay registros con los filtros seleccionados</td></tr>';
        return;
    }

    asistenciasTableBody.innerHTML = data.map(reg => `
        <tr class="border-b border-gray-800 hover:bg-gray-800/30">
            <td class="px-4 py-3">${reg.dni || reg.empleados?.dni || '—'}</td>
            <td class="px-4 py-3">${reg.empleados?.nombre || '—'}</td>
            <td class="px-4 py-3">${reg.fecha}</td>
            <td class="px-4 py-3">${reg.hora_entrada || '—'}</td>
            <td class="px-4 py-3">${reg.hora_salida || '—'}</td>
            <td class="px-4 py-3 text-orange-400 font-semibold">${reg.horas_extras ? reg.horas_extras + ' h' : '0 h'}</td>
        </tr>
    `).join('');
}

async function actualizarEstadisticas() {
    const { count: empCount } = await supabase.from('empleados').select('*', { count: 'exact', head: true });
    const hoy = new Date().toISOString().split('T')[0];
    const { count: asisHoy } = await supabase.from('asistencias').select('*', { count: 'exact', head: true }).eq('fecha', hoy);
    document.getElementById('totalEmpleados').innerText = empCount || 0;
    document.getElementById('totalHoy').innerText = asisHoy || 0;
    document.getElementById('lastSync').innerText = new Date().toLocaleTimeString();
}

// ==================== EXPORTACIÓN A PDF ====================
async function exportarPDF() {
    if (asistenciasData.length === 0) {
        mostrarAlerta("No hay datos para exportar. Aplica filtros primero.", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    
    // Encabezado corporativo
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 297, 40, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('NEXUS TIME - REPORTE DE ASISTENCIAS', 148, 20, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generado: ${new Date().toLocaleString()}`, 148, 32, { align: 'center' });
    
    // Información de filtros
    const empleadoSeleccionado = filtroEmpleado.options[filtroEmpleado.selectedIndex]?.text || 'Todos';
    const fechaInicioVal = fechaInicio.value || 'Sin límite';
    const fechaFinVal = fechaFin.value || 'Sin límite';
    
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Empleado: ${empleadoSeleccionado}`, 20, 50);
    doc.text(`Período: ${fechaInicioVal} - ${fechaFinVal}`, 20, 57);
    
    // Preparar datos para la tabla
    const tableData = asistenciasData.map(reg => [
        reg.dni || reg.empleados?.dni || '—',
        reg.empleados?.nombre || '—',
        reg.fecha,
        reg.hora_entrada || '—',
        reg.hora_salida || '—',
        `${reg.horas_extras || 0} h`
    ]);
    
    // Configurar autoTable
    doc.autoTable({
        startY: 65,
        head: [['DNI', 'Empleado', 'Fecha', 'Entrada', 'Salida', 'Horas Extras']],
        body: tableData,
        theme: 'striped',
        headStyles: {
            fillColor: [16, 185, 129],
            textColor: 255,
            fontStyle: 'bold',
            halign: 'center'
        },
        bodyStyles: { textColor: 50, fontSize: 9 },
        alternateRowStyles: { fillColor: [240, 248, 255] },
        margin: { left: 20, right: 20 },
        columnStyles: {
            0: { cellWidth: 30 },
            1: { cellWidth: 45 },
            2: { cellWidth: 30, halign: 'center' },
            3: { cellWidth: 25, halign: 'center' },
            4: { cellWidth: 25, halign: 'center' },
            5: { cellWidth: 30, halign: 'center' }
        }
    });
    
    // Calcular totales
    const totalDias = asistenciasData.length;
    const totalHorasExtras = asistenciasData.reduce((sum, reg) => sum + (parseFloat(reg.horas_extras) || 0), 0);
    const finalY = doc.lastAutoTable.finalY + 10;
    
    // Sección de Totales
    doc.setFillColor(240, 248, 255);
    doc.roundedRect(20, finalY, 257, 35, 3, 3, 'F');
    doc.setDrawColor(16, 185, 129);
    doc.setLineWidth(0.5);
    doc.roundedRect(20, finalY, 257, 35, 3, 3, 'D');
    
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text('RESUMEN DEL PERÍODO', 148, finalY + 10, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(`• Total de días laborados: ${totalDias}`, 35, finalY + 22);
    doc.text(`• Acumulado de horas extras: ${totalHorasExtras.toFixed(2)} horas`, 160, finalY + 22);
    doc.text(`• Promedio de horas extras por día: ${(totalHorasExtras / totalDias).toFixed(2)} horas`, 35, finalY + 30);
    
    // Pie de página
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text('Nexus Time - Sistema de Gestión de Asistencias', 148, 197, { align: 'center' });
        doc.text(`Página ${i} de ${pageCount}`, 270, 197, { align: 'right' });
    }
    
    doc.save(`reporte_asistencias_${fechaInicioVal}_a_${fechaFinVal}.pdf`);
    mostrarAlerta("PDF generado exitosamente", "success");
}

// ==================== ADMINISTRACIÓN Y AUTENTICACIÓN ====================
async function handleAdminLogin(event) {
    event.preventDefault();
    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    const loginErrorDiv = document.getElementById('loginErrorMsg');
    loginErrorDiv.classList.add('hidden');
    
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        currentSession = data.session;
        mostrarAlerta("Acceso concedido al panel", "success");
        showView('admin');
        await cargarEmpleadosSelect();
        await renderizarTablaAsistencias({});
        await actualizarEstadisticas();
    } catch (err) { 
        loginErrorDiv.innerText = err.message; 
        loginErrorDiv.classList.remove('hidden'); 
    }
}

async function logoutAdmin() {
    await supabase.auth.signOut();
    currentSession = null;
    showView('public');
    mostrarAlerta("Sesión cerrada", "success");
}

async function verificarSesionActual() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentSession = session;
        showView('admin');
        await cargarEmpleadosSelect();
        await renderizarTablaAsistencias({});
        await actualizarEstadisticas();
    } else {
        showView('public');
    }
}

// ==================== EVENT LISTENERS ====================
btnEntrada.addEventListener('click', marcarEntrada);
btnSalida.addEventListener('click', marcarSalida);
document.getElementById('goToAdminBtn')?.addEventListener('click', () => showView('login'));
document.getElementById('backToPublicFromLogin')?.addEventListener('click', () => showView('public'));
document.getElementById('loginForm')?.addEventListener('submit', handleAdminLogin);
document.getElementById('logoutAdminBtn')?.addEventListener('click', logoutAdmin);
document.getElementById('aplicarFiltrosBtn')?.addEventListener('click', async () => {
    await renderizarTablaAsistencias({
        dni: filtroEmpleado.value,
        fechaInicio: fechaInicio.value,
        fechaFin: fechaFin.value
    });
});
document.getElementById('exportarPDFBtn')?.addEventListener('click', exportarPDF);

// ==================== INICIALIZAR APLICACIÓN ====================
verificarSesionActual();
console.log("Sistema listo. Asegúrate de crear las tablas: empleados (id, dni, nombre, email, area) y asistencias (id, empleado_id, dni, fecha, hora_entrada, hora_salida, horas_regulares, horas_extras)");