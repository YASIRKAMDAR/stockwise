package app.stockwise.manager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.stockwise.manager.*

// Hotels ask the central warehouse; the warehouse sends. These pieces appear on Today and Deliveries for both sides.

/** Hotel side: open and on-the-way requests, plus the Ask button. */
@Composable
fun FromWarehousePanel(s: AppState, onAsk: () -> Unit) {
    val t = s.t
    val mine = s.requests.filter { it.status == "OPEN" || it.status == "SENT" }
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t.fromWarehouse, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.weight(1f))
            PillButton(t.askWarehouse, filled = true, color = C.Indigo) { onAsk() }
        }
        if (mine.isEmpty()) Text(t.nothingLow.replace(".", ""), fontSize = 13.sp, color = C.Ink3)
        mine.forEach { r ->
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(if (r.status == "SENT") "🚚" else "⏳", fontSize = 20.sp); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(r.lines.joinToString { "${it.quantity} ${s.product(it.productId)?.native(s.lang) ?: it.name}" }, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(if (r.status == "SENT") "${t.onItsWay}${r.transferRef?.let { " · $it" } ?: ""}" else "${t.waitingForWarehouse} · ${t.askedAgo(r.ageHours.toInt())}", fontSize = 12.sp, color = C.Ink2)
                }
                if (r.status == "OPEN") Box(Modifier.clickable { s.declineRequest(r) }) { Tag(t.cancel, C.Ink2, C.Linen) }
            }
        }
    }
}

/** Warehouse side: one card per hotel request with Send all / Change / Decline. */
@Composable
fun HotelsAskingPanel(s: AppState, onChange: (StockRequest) -> Unit) {
    val t = s.t
    Text(t.hotelsAsking, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
    if (s.openRequests.isEmpty()) Text(t.nobodyAsking, color = C.Ink2)
    s.openRequests.forEach { r ->
        val short = r.lines.any { it.warehouseStock < it.quantity }
        Panel(border = if (short) C.Marigold else C.Line) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.hotel.name, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Tag(t.askedAgo(r.ageHours.toInt()), C.Ink2, C.Linen)
            }
            r.lines.forEach { l ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.product(l.productId)?.emoji() ?: "📦", fontSize = 18.sp); Spacer(Modifier.width(8.dp))
                    Text(s.product(l.productId)?.native(s.lang) ?: l.name, fontSize = 15.sp, modifier = Modifier.weight(1f))
                    Text("${l.quantity}", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = if (l.warehouseStock < l.quantity) C.Brick else C.Ink)
                    Text("  · ${t.warehouseHas} ${l.warehouseStock}", fontSize = 12.sp, color = if (l.warehouseStock < l.quantity) C.Brick else C.Ink2)
                }
            }
            r.note?.takeIf { it.isNotBlank() }?.let { Text("“$it” — ${r.requestedBy}", fontSize = 12.sp, color = C.Ink2) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(t.sendAll, Modifier.weight(1f), filled = true, color = C.Mint, enabled = !short) { s.sendRequest(r) }
                PillButton(t.change, Modifier.weight(1f)) { onChange(r) }
                PillButton(t.decline, Modifier.weight(1f), color = C.Brick) { s.declineRequest(r) }
            }
        }
    }
}

/** Hotel: pick quantities (pre-filled to par) and send the request. */
@Composable
fun AskSheet(s: AppState, onClose: () -> Unit) {
    val t = s.t
    LaunchedEffect(s.hotelId) { s.loadTopUp() }
    val top = s.topUp
    var qty by remember(top) { mutableStateOf(top?.lines?.associate { it.productId to it.quantity } ?: emptyMap()) }
    ModalBottomSheet(onDismissRequest = onClose, containerColor = C.Linen) {
        Column(Modifier.padding(20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(t.askWarehouse, fontSize = 20.sp, fontWeight = FontWeight.Bold)
            if (top == null) CircularProgressIndicator(Modifier.size(28.dp), color = C.Indigo) else {
                Text(t.toPar, fontSize = 13.sp, color = C.Ink2)
                top.lines.forEach { l ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(s.product(l.productId)?.emoji() ?: "📦", fontSize = 22.sp); Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.product(l.productId)?.native(s.lang) ?: l.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                            Text("${t.stock} ${l.store} · ${t.warehouseHas} ${l.warehouse}" + (if (l.onTheWay > 0) " · ${l.onTheWay} ${t.onItsWay.lowercase()}" else ""), fontSize = 12.sp, color = C.Ink2)
                        }
                        Counter(qty[l.productId] ?: 0, 0, l.warehouse.coerceAtLeast(0)) { qty = qty + (l.productId to it) }
                    }
                }
                BigButton(t.sendRequest, { s.askWarehouse(qty); onClose() }, enabled = qty.values.any { it > 0 })
            }
        }
    }
}

/** Warehouse: change what goes out before sending. */
@Composable
fun SendRequestSheet(s: AppState, r: StockRequest, onClose: () -> Unit) {
    val t = s.t
    var qty by remember(r.id) { mutableStateOf(r.lines.associate { it.productId to it.quantity.coerceAtMost(it.warehouseStock) }) }
    ModalBottomSheet(onDismissRequest = onClose, containerColor = C.Linen) {
        Column(Modifier.padding(20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${t.send} · ${r.hotel.name}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            r.lines.forEach { l ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.product(l.productId)?.emoji() ?: "📦", fontSize = 22.sp); Spacer(Modifier.width(8.dp))
                    Column(Modifier.weight(1f)) {
                        Text(s.product(l.productId)?.native(s.lang) ?: l.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Text("${t.askWarehouse.substringBefore(' ')} ${l.quantity} · ${t.warehouseHas} ${l.warehouseStock}", fontSize = 12.sp, color = C.Ink2)
                    }
                    Counter(qty[l.productId] ?: 0, 0, l.warehouseStock) { qty = qty + (l.productId to it) }
                }
            }
            BigButton(t.send, { s.sendRequest(r, qty); onClose() }, color = C.Mint, enabled = qty.values.any { it > 0 })
        }
    }
}

/** Hotel: the weekly auto-request switch. */
@Composable
fun AutoAskPanel(s: AppState) {
    val t = s.t
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(t.autoAsk, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                Text(t.autoAskHint, fontSize = 12.sp, color = C.Ink2)
            }
            Switch(s.schedules.any { it.active }, { s.setAutoAsk(it) })
        }
    }
}

/** In the conversation: a spoken request waiting for Send. */
@Composable
fun AskCard(s: AppState, m: ChatMessage, b: ChatBody.Ask) {
    val t = s.t
    AppBubble {
        Text(t.askWarehouse, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
        b.lines.forEach { (p, q) -> Row { Text("${p.emoji()} ${p.native(s.lang) ?: p.name}", fontSize = 16.sp); Spacer(Modifier.weight(1f)); Text("$q", fontWeight = FontWeight.ExtraBold, fontSize = 17.sp) } }
        if (b.sent) Tag(t.requestSent, C.Mint, Color(0xFFE3F4EC))
        else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PillButton(t.sendRequest, Modifier.weight(1f), filled = true, color = C.Indigo) { s.confirmAsk(m) }
            PillButton(t.cancel, Modifier.weight(1f)) { s.chat = s.chat.filter { it.id != m.id } }
        }
    }
}
