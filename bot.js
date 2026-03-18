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

<b>P</b> [ubicación]
[código1] [código2]...
  Un lado: <code>P Ñ-08-2-B
YL-23119</code>
  Ambos lados: <code>P Ñ-08-2-AB
YL-23119</code>

<b>BORRAR</b> [ubicación]
  Toda la posición: <code>BORRAR Ñ-08-2-B</code>
  Un código: <code>BORRAR Ñ-08-2-B YL-23119</code>

<b>MOVER</b> [origen]
[destino]
  Todo el pallet: <code>MOVER A-07-2-A
Ñ-09-2-B</code>
  Códigos específicos: <code>MOVER A-07-2-A
Ñ-09-2-B
YL-23119</code>

<b>ENTRADA</b> [código] [color] [cantidad]
  <code>ENTRADA YL-23075 Blanco 10</code>

<b>SALIDA</b> [código] [color] [cantidad]
  <code>SALIDA K522 Negro 5</code>

<b>STOCK</b> [código] [color]
  <code>STOCK YL-23075 Blanco</code>

<b>BUSCAR</b> [código]
  <code>BUSCAR YL-23075</code>

<b>ALERTAS</b>
  Productos con stock bajo o sin stock

<b>/REGISTRAR</b>
  Recibir notificaciones automáticas en este chat

<b>/DESREGISTRAR</b>
  Dejar de recibir notificaciones

<b>/MIID</b>
  Ver tu Chat ID

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

  // REGISTRAR — guardar chat_id para recibir notificaciones
  if (comando === '/REGISTRAR' || comando === 'REGISTRAR') {
    try {
      // Verificar si ya existe
      const existentes = await supabaseGet('telegram_chats', `?chat_id=eq.${chatId}`);
      if (existentes && existentes.length > 0) {
        return sendMessage(chatId, `✅ Ya estás registrado para recibir notificaciones.\n\n👤 <b>${nombreUsuario}</b>\n🆔 Chat ID: <code>${chatId}</code>`);
      }
      await supabasePost('telegram_chats', { chat_id: chatId, nombre: nombreUsuario });
      return sendMessage(chatId, `✅ <b>¡Registrado con éxito!</b>\n\nA partir de ahora vas a recibir notificaciones automáticas de:\n📦 Productos creados/eliminados\n📥 Entradas y salidas de stock\n🚚 Movimientos de ubicación\n\n👤 <b>${nombreUsuario}</b>\n🆔 Chat ID: <code>${chatId}</code>`);
    } catch(e) {
      return sendMessage(chatId, `❌ Error al registrar: ${e.message}`);
    }
  }

  // DESREGISTRAR — dejar de recibir notificaciones
  if (comando === '/DESREGISTRAR' || comando === 'DESREGISTRAR') {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/telegram_chats?chat_id=eq.${chatId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      return sendMessage(chatId, `🔕 Desregistrado. Ya no vas a recibir notificaciones.`);
    } catch(e) {
      return sendMessage(chatId, `❌ Error: ${e.message}`);
    }
  }

  // MIID — ver tu chat ID
  if (comando === '/MIID' || comando === 'MIID') {
    return sendMessage(chatId, `🆔 Tu Chat ID es: <code>${chatId}</code>`);
  }

  // POSICION / P — carga múltiples productos en una ubicación
  if (comando === 'POSICION' || comando === 'P') {
    const lineas = texto.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lineas.length < 2) {
      return sendMessage(chatId, `❌ Formato:\n<code>P [ubicación]\n[código1]\n[código2]\n...</code>\n\nUn lado:\n<code>P Ñ-08-2-B\nYL-23119\nYL-23019</code>\n\nAmbos lados A y B:\n<code>P Ñ-08-2-AB\nYL-23119\nYL-23019</code>`);
    }

    const ubicacionRaw = lineas[0].replace(/^(POSICION|P)\s+/i, '').trim().toUpperCase();
    const codigos = lineas.slice(1).map(l => l.toUpperCase());

    if (!ubicacionRaw) {
      return sendMessage(chatId, '❌ Falta la ubicación. Ej: <code>POSICION Ñ-08-2-B</code>');
    }

    // Detectar si termina en AB → cargar en ambos lados
    const esAB = ubicacionRaw.endsWith('-AB');
    const ubicaciones = esAB
      ? [ubicacionRaw.replace(/-AB$/, '-A'), ubicacionRaw.replace(/-AB$/, '-B')]
      : [ubicacionRaw];

    let creados = [];
    let yaExistian = [];
    let errores = [];

    for (const ubicacion of ubicaciones) {
      for (const codigo of codigos) {
        if (!codigo) continue;
        const existentes = await supabaseGet('productos', `?codigo=eq.${encodeURIComponent(codigo)}&ubicacion=eq.${encodeURIComponent(ubicacion)}`);
        if (Array.isArray(existentes) && existentes.length > 0) {
          yaExistian.push(`${codigo} (${ubicacion})`);
          continue;
        }
        const result = await supabasePost('productos', {
          codigo,
          color: 'Sin definir',
          stock: 0,
          minimo: 0,
          zona: 'PALLETS',
          ubicacion,
          descripcion: `Cargado por ${nombreUsuario} vía Telegram`
        });
        if (result && !result.error) {
          creados.push(esAB ? `${codigo} (${ubicacion})` : codigo);
        } else {
          errores.push(codigo);
        }
      }
    }

    let msg = esAB
      ? `📍 <b>Posición: ${ubicacionRaw.replace(/-AB$/, '')} — Lado A y B</b>\n\n`
      : `📍 <b>Posición: ${ubicacionRaw}</b>\n\n`;
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

  // BORRAR — borra productos de una posición
  if (comando === 'BORRAR') {
    if (partes.length < 2) {
      return sendMessage(chatId, `❌ Formato:\n\nBorrar toda la posición:\n<code>BORRAR Ñ-08-2-B</code>\n\nBorrar un código específico:\n<code>BORRAR Ñ-08-2-B YL-23119</code>`);
    }

    const ubicacion = partes[1].toUpperCase();
    const codigoEspecifico = partes[2] ? partes[2].toUpperCase() : null;

    // Buscar productos a borrar
    let filtro = `?ubicacion=eq.${encodeURIComponent(ubicacion)}`;
    if (codigoEspecifico) filtro += `&codigo=eq.${encodeURIComponent(codigoEspecifico)}`;
    const encontrados = await supabaseGet('productos', filtro);

    if (!Array.isArray(encontrados) || !encontrados.length) {
      return sendMessage(chatId, `❌ No encontré productos en <b>${ubicacion}</b>${codigoEspecifico ? ' con código <b>'+codigoEspecifico+'</b>' : ''}.`);
    }

    // Borrar
    let borrados = [];
    let errores = [];
    for (const p of encontrados) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/productos?id=eq.${p.id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (res.ok) borrados.push(`${p.codigo} ${p.color !== 'Sin definir' ? p.color : ''}`);
      else errores.push(p.codigo);
    }

    let msg = `🗑️ <b>Borrado en ${ubicacion}</b>\n\n`;
    if (borrados.length) {
      msg += `✅ <b>Eliminados (${borrados.length}):</b>\n`;
      borrados.forEach(c => msg += `  • ${c}\n`);
    }
    if (errores.length) {
      msg += `\n❌ <b>Error al eliminar (${errores.length}):</b>\n`;
      errores.forEach(c => msg += `  • ${c}\n`);
    }
    msg += `\nRealizado por: ${nombreUsuario}`;
    return sendMessage(chatId, msg);
  }

  // MOVER — mueve productos de una posición a otra
  if (comando === 'MOVER') {
    const lineas = texto.trim().split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lineas.length < 2) {
      return sendMessage(chatId, `❌ Formato:\n<code>MOVER [origen]\n[destino]</code>\n\nPara mover todo el pallet:\n<code>MOVER A-07-2-A\nÑ-09-2-B</code>\n\nPara mover códigos específicos:\n<code>MOVER A-07-2-A\nÑ-09-2-B\nYL-23119\nYL-23019</code>`);
    }

    const origen = lineas[0].replace(/^MOVER\s+/i, '').trim().toUpperCase();
    const destino = lineas[1].trim().toUpperCase();
    const codigosEspecificos = lineas.slice(2).map(l => l.toUpperCase()).filter(l => l.length > 0);

    if (!origen || !destino) {
      return sendMessage(chatId, '❌ Falta origen o destino.\nEj: <code>MOVER A-07-2-A\nÑ-09-2-B</code>');
    }

    // Buscar productos en la posición origen
    let productosOrigen;
    if (codigosEspecificos.length > 0) {
      // Mover solo los códigos especificados
      productosOrigen = await supabaseGet('productos', `?ubicacion=eq.${encodeURIComponent(origen)}&codigo=in.(${codigosEspecificos.join(',')})`);
    } else {
      // Mover todo el pallet
      productosOrigen = await supabaseGet('productos', `?ubicacion=eq.${encodeURIComponent(origen)}`);
    }

    if (!Array.isArray(productosOrigen) || !productosOrigen.length) {
      return sendMessage(chatId, `❌ No encontré productos en <b>${origen}</b>${codigosEspecificos.length ? ' con esos códigos' : ''}.`);
    }

    let movidos = [];
    let errores = [];

    for (const p of productosOrigen) {
      const result = await supabasePatch('productos', `id=eq.${p.id}`, { ubicacion: destino });
      if (Array.isArray(result) && result.length > 0) {
        movidos.push(p.codigo);
        // Registrar en historial
        await supabasePost('movimientos', {
          tipo: 'MOVIMIENTO',
          codigo: p.codigo,
          color: p.color,
          cantidad: 0,
          responsable: nombreUsuario || 'Telegram',
          nota: `Movido de ${origen} a ${destino} por ${nombreUsuario}`
        });
      } else {
        errores.push(p.codigo);
      }
    }

    let msg = `🚚 <b>Movimiento de pallet</b>\n\n`;
    msg += `📤 Origen: <b>${origen}</b>\n`;
    msg += `📥 Destino: <b>${destino}</b>\n\n`;
    if (movidos.length) {
      msg += `✅ <b>Movidos (${movidos.length}):</b>\n`;
      movidos.forEach(c => msg += `  • ${c}\n`);
    }
    if (errores.length) {
      msg += `\n❌ <b>Error al mover (${errores.length}):</b>\n`;
      errores.forEach(c => msg += `  • ${c}\n`);
    }
    msg += `\nRealizado por: ${nombreUsuario}`;
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

  // BUSCAR [código] — también acepta atajo "B [código]"
  if (comando === 'BUSCAR' || comando === 'B') {
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
