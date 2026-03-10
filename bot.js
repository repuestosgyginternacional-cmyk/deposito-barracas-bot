const express = require('express');
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

// ===================== ENVIAR MENSAJE =====================
async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
  });
}

// ===================== SUPABASE =====================
async function supabaseGet(tabla, filtros = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}${filtros}`, {
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`
    }
  });
  return res.json();
}

async function supabasePatch(tabla, filtro, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${filtro}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

async function supabasePost(tabla, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify(body)
  });
  return res.json();
}

// ===================== AYUDA =====================
const AYUDA = `
📦 <b>Bot Depósito Barracas</b>

Comandos disponibles:

<b>POSICION</b> [ubicación]
[código1]
[código2]
  Ej:
<code>POSICION Ñ-08-2-B
YL-23119
YL-23019
YL-23108</code>

<b>ENTRADA</b> [código] [color] [cantidad]
  Ej: <code>ENTRADA YL-23075 Blanco 10</code>

<b>SALIDA</b> [código] [color] [cantidad]
  Ej: <code>SALIDA K522 Negro 5</code>

<b>STOCK</b> [código] [color]
  Ej: <code>STOCK YL-23075 Blanco</code>

<b>BUSCAR</b> [código]
  Ej: <code>BUSCAR YL-23075</code>

<b>ALERTAS</b>
  Ver todos los productos con stock bajo o sin stock

<b>AYUDA</b>
  Ver este mensaje
`;

// ===================== PROCESAR MENSAJE =====================
async function procesarMensaje(chatId, texto, nombreUsuario) {
  const partes = texto.trim().split(/\s+/);
  const comando = partes[0].toUpperCase();

  // AYUDA / START
  if (comando === 'AYUDA' || comando === '/START' || comando === '/AYUDA') {
    return sendMessage(chatId, AYUDA);
  }

  // POSICION — carga múltiples productos en una ubicación
  if (comando === 'POSICION') {
    const lineas = texto.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lineas.length < 2) {
      return sendMessage(chatId, `❌ Formato:\n<code>POSICION [ubicación]\n[código1]\n[código2]\n...</code>\n\nEj:\n<code>POSICION Ñ-08-2-B\nYL-23119\nYL-23019\nYL-23108</code>`);
    }

    // Primera línea: POSICION Ñ-08-2-B → extraer ubicación
    const ubicacionRaw = lineas[0].replace(/^POSICION\s+/i, '').trim().toUpperCase();
    const codigos = lineas.slice(1).map(l => l.toUpperCase());

    if (!ubicacionRaw) {
      return sendMessage(chatId, '❌ Falta la ubicación. Ej: <code>POSICION Ñ-08-2-B</code>');
    }

    let creados = [];
    let yaExistian = [];
    let errores = [];

    for (const codigo of codigos) {
      if (!codigo) continue;
      // Verificar si ya existe (sin color definido aún)
      const existentes = await supabaseGet('productos', `?codigo=eq.${encodeURIComponent(codigo)}&ubicacion=eq.${encodeURIComponent(ubicacionRaw)}`);
      if (Array.isArray(existentes) && existentes.length > 0) {
        yaExistian.push(codigo);
        continue;
      }
      // Crear producto sin color, stock 0
      const result = await supabasePost('productos', {
        codigo,
        color: 'Sin definir',
        stock: 0,
        minimo: 0,
        zona: 'PALLETS',
        ubicacion: ubicacionRaw,
        descripcion: `Cargado por ${nombreUsuario} vía Telegram`
      });
      if (result && !result.error) {
        creados.push(codigo);
      } else {
        errores.push(codigo);
      }
    }

    let msg = `📍 <b>Posición: ${ubicacionRaw}</b>\n\n`;
    if (creados.length) {
      msg += `✅ <b>Creados (${creados.length}):</b>\n`;
      creados.forEach(c => msg += `  • ${c}\n`);
      msg += '\n';
    }
    if (yaExistian.length) {
      msg += `⚠️ <b>Ya existían (${yaExistian.length}):</b>\n`;
      yaExistian.forEach(c => msg += `  • ${c}\n`);
      msg += '\n';
    }
    if (errores.length) {
      msg += `❌ <b>Error al crear (${errores.length}):</b>\n`;
      errores.forEach(c => msg += `  • ${c}\n`);
      msg += '\n';
    }
    if (creados.length) {
      msg += `💡 Ahora usá <code>ENTRADA [código] [color] [cantidad]</code> para agregar el color y stock.`;
    }
    return sendMessage(chatId, msg);
  }

  // ALERTAS
  if (comando === 'ALERTAS') {
    const productos = await supabaseGet('productos', '?select=codigo,color,stock,minimo,ubicacion&order=codigo');
    if (!Array.isArray(productos)) return sendMessage(chatId, '❌ Error al consultar la base de datos.');
    const alertas = productos.filter(p => p.stock === 0 || (p.minimo > 0 && p.stock <= p.minimo));
    if (!alertas.length) return sendMessage(chatId, '✅ <b>Todo en orden</b> — No hay alertas de stock.');
    let msg = '⚠️ <b>Alertas de Stock</b>\n\n';
    alertas.forEach(p => {
      const icono = p.stock === 0 ? '🚨' : '⚠️';
      msg += `${icono} <b>${p.codigo} ${p.color}</b>\n`;
      msg += `   Stock: ${p.stock}${p.minimo > 0 ? ` (mín: ${p.minimo})` : ''}`;
      if (p.ubicacion) msg += ` · 📍 ${p.ubicacion}`;
      msg += '\n\n';
    });
    return sendMessage(chatId, msg);
  }

  // STOCK [código] [color]
  if (comando === 'STOCK') {
    if (partes.length < 3) return sendMessage(chatId, '❌ Formato: <code>STOCK [código] [color]</code>\nEj: <code>STOCK YL-23075 Blanco</code>');
    const codigo = partes[1].toUpperCase();
    const color = partes.slice(2).join(' ');
    const productos = await supabaseGet('productos', `?codigo=eq.${codigo}&color=ilike.${encodeURIComponent(color)}&select=*`);
    if (!Array.isArray(productos) || !productos.length) {
      return sendMessage(chatId, `❌ No encontré <b>${codigo} ${color}</b> en el sistema.`);
    }
    const p = productos[0];
    const estado = p.stock === 0 ? '🚨 SIN STOCK' : (p.minimo > 0 && p.stock <= p.minimo) ? '⚠️ STOCK BAJO' : '✅ OK';
    let msg = `📦 <b>${p.codigo} ${p.color}</b>\n`;
    msg += `Stock: <b>${p.stock}</b> unidades\n`;
    msg += `Mínimo: ${p.minimo}\n`;
    msg += `Estado: ${estado}\n`;
    if (p.ubicacion) msg += `Ubicación: 📍 ${p.ubicacion}\n`;
    if (p.zona) msg += `Zona: ${p.zona}`;
    return sendMessage(chatId, msg);
  }

  // BUSCAR [código]
  if (comando === 'BUSCAR') {
    if (partes.length < 2) return sendMessage(chatId, '❌ Formato: <code>BUSCAR [código]</code>\nEj: <code>BUSCAR YL-23075</code>');
    const codigo = partes[1].toUpperCase();
    const productos = await supabaseGet('productos', `?codigo=ilike.${encodeURIComponent('%'+codigo+'%')}&select=*&order=color`);
    if (!Array.isArray(productos) || !productos.length) {
      return sendMessage(chatId, `❌ No encontré productos con código <b>${codigo}</b>.`);
    }
    let msg = `🔍 <b>Resultados para "${codigo}"</b>\n\n`;
    productos.forEach(p => {
      const estado = p.stock === 0 ? '🚨' : (p.minimo > 0 && p.stock <= p.minimo) ? '⚠️' : '✅';
      msg += `${estado} <b>${p.codigo} ${p.color}</b> — Stock: ${p.stock}`;
      if (p.ubicacion) msg += ` · 📍 ${p.ubicacion}`;
      msg += '\n';
    });
    return sendMessage(chatId, msg);
  }

  // ENTRADA / SALIDA
  if (comando === 'ENTRADA' || comando === 'SALIDA') {
    if (partes.length < 4) {
      return sendMessage(chatId, `❌ Formato: <code>${comando} [código] [color] [cantidad]</code>\nEj: <code>${comando} YL-23075 Blanco 10</code>`);
    }
    const codigo = partes[1].toUpperCase();
    const cantidad = parseInt(partes[partes.length - 1]);
    const color = partes.slice(2, partes.length - 1).join(' ');

    if (isNaN(cantidad) || cantidad <= 0) {
      return sendMessage(chatId, '❌ La cantidad debe ser un número mayor a 0.');
    }

    // Buscar producto
    const productos = await supabaseGet('productos', `?codigo=eq.${codigo}&color=ilike.${encodeURIComponent(color)}&select=*`);
    if (!Array.isArray(productos) || !productos.length) {
      return sendMessage(chatId, `❌ No encontré <b>${codigo} ${color}</b> en el sistema.\n\nUsá <code>BUSCAR ${codigo}</code> para ver los colores disponibles.`);
    }

    const p = productos[0];

    // Validar stock para salida
    if (comando === 'SALIDA' && cantidad > p.stock) {
      return sendMessage(chatId, `❌ Stock insuficiente.\n<b>${codigo} ${color}</b> tiene solo <b>${p.stock}</b> unidades.\nSolicitás: ${cantidad}`);
    }

    const nuevoStock = comando === 'ENTRADA' ? p.stock + cantidad : p.stock - cantidad;

    // Actualizar stock
    await supabasePatch('productos', `codigo=eq.${codigo}&color=ilike.${encodeURIComponent(color)}`, { stock: nuevoStock });

    // Registrar movimiento
    await supabasePost('movimientos', {
      tipo: comando,
      codigo: p.codigo,
      color: p.color,
      cantidad,
      responsable: nombreUsuario || 'Telegram',
      nota: `Registrado via bot por ${nombreUsuario || 'usuario'}`
    });

    const icono = comando === 'ENTRADA' ? '📥' : '📤';
    const signo = comando === 'ENTRADA' ? '+' : '-';
    let msg = `${icono} <b>${comando} registrada</b>\n\n`;
    msg += `Producto: <b>${p.codigo} ${p.color}</b>\n`;
    msg += `Cantidad: ${signo}${cantidad}\n`;
    msg += `Stock anterior: ${p.stock}\n`;
    msg += `Stock nuevo: <b>${nuevoStock}</b>\n`;
    if (p.ubicacion) msg += `Ubicación: 📍 ${p.ubicacion}\n`;
    msg += `\nRegistrado por: ${nombreUsuario || 'usuario'}`;

    // Alerta si quedó bajo
    if (p.minimo > 0 && nuevoStock <= p.minimo && nuevoStock > 0) {
      msg += `\n\n⚠️ <b>Atención:</b> Stock quedó por debajo del mínimo (${p.minimo})`;
    }
    if (nuevoStock === 0) {
      msg += `\n\n🚨 <b>¡SIN STOCK!</b> Este producto se quedó sin unidades.`;
    }

    return sendMessage(chatId, msg);
  }

  // Comando no reconocido
  return sendMessage(chatId, `❓ No entendí ese comando.\n\nEscribí <code>AYUDA</code> para ver todos los comandos disponibles.`);
}

// ===================== WEBHOOK =====================
app.post('/webhook', async (req, res) => {
  res.sendStatus(200); // Responder rápido a Telegram
  try {
    const update = req.body;
    if (!update.message || !update.message.text) return;
    const chatId = update.message.chat.id;
    const texto = update.message.text;
    const nombre = update.message.from?.first_name || update.message.from?.username || 'Usuario';
    await procesarMensaje(chatId, texto, nombre);
  } catch (e) {
    console.error('Error procesando mensaje:', e);
  }
});

// Health check
app.get('/', (req, res) => res.send('🟢 Bot Depósito Barracas activo'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot corriendo en puerto ${PORT}`));
