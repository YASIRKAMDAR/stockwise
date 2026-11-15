package app.stockwise.manager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.stockwise.manager.*

// ---------- Weekly count ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountScreen(s: AppState, mic: Mic) {
    val t = s.t
    val sheet = s.sheet
    var editing by remember { mutableStateOf<String?>(null) }
    var typed by remember { mutableStateOf("") }
    var reasonFor by remember { mutableStateOf<String?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    if (sheet == null) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            val st = s.countStatus?.state ?: "DUE"
            Panel(border = when (st) { "OVERDUE" -> C.Brick; "COMPLETED" -> C.Mint; else -> C.Marigold }) {
                Text(when (st) { "COMPLETED" -> t.countDone; "OVERDUE" -> t.countOverdue; else -> t.countDue }, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                s.countStatus?.lastSubmittedAt?.let { Text(it.take(10), fontSize = 13.sp, color = C.Ink2) }
                Spacer(Modifier.height(6.dp))
                BigButton(t.startCount, { s.startCount() })
            }
            if (s.pastCounts.isNotEmpty()) {
                Text(t.lastCounts, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
                Panel {
                    s.pastCounts.take(8).forEach { c ->
                        Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text((c.submittedAt ?: c.startedAt ?: "").take(10), fontSize = 15.sp, modifier = Modifier.weight(1f))
                            c.absVariance?.let { Text("±$it", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (it == 0) C.Mint else C.Amber); Spacer(Modifier.width(8.dp)) }
                            Tag(c.status, C.Ink2, C.Linen)
                        }
                    }
                }
            }
        }
        return
    }
    val done = sheet.lines.count { it.physicalQty != null }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        LatestReply(s)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t.progress(done, sheet.lines.size), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.weight(1f))
            if (s.countSaving) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = C.Indigo)
        }
        if (sheet.changedCount > 0) Banner(t.stockMoved)
        Panel {
            sheet.lines.forEachIndexed { i, l ->
                val diff = (l.variance ?: 0) != 0 && l.physicalQty != null
                Column(Modifier.padding(vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(s.product(l.productId)?.emoji() ?: l.icon ?: "📦", fontSize = 24.sp, modifier = Modifier.width(32.dp))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Text(s.product(l.productId)?.native(s.lang) ?: l.name, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                            Text("${t.book} ${l.expectedQty}", fontSize = 12.sp, color = C.Ink2)
                        }
                        if (editing == l.productId) {
                            OutlinedTextField(typed, { v -> typed = v.filter { it.isDigit() }.take(6) }, Modifier.width(84.dp), singleLine = true, textStyle = MaterialTheme.typography.titleLarge.copy(textAlign = TextAlign.Center),
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
                            Spacer(Modifier.width(6.dp))
                            IconButton({ typed.toIntOrNull()?.let { n -> s.setCount(l.productId, n); if (n != l.expectedQty) reasonFor = l.productId }; editing = null },
                                Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(C.Mint)) { Icon(Icons.Filled.Check, null, tint = Color.White) }
                        } else {
                            val (tone, bg, fg) = when { l.physicalQty == null -> Triple(C.Line, C.Paper, C.Ink3); diff -> Triple(C.Marigold, C.MarigoldWash, C.Amber); else -> Triple(C.Mint, C.MintWash, C.Mint) }
                            Box(Modifier.widthIn(min = 60.dp).height(44.dp).clip(RoundedCornerShape(12.dp)).background(bg).border(1.5.dp, tone, RoundedCornerShape(12.dp))
                                .clickable { editing = l.productId; typed = l.physicalQty?.toString() ?: "" }.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
                                Text(l.physicalQty?.toString() ?: "—", fontSize = 20.sp, fontWeight = FontWeight.ExtraBold, color = fg)
                            }
                        }
                    }
                    if (diff) Row(Modifier.padding(start = 42.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(l.reason?.let { t.reason(it) } ?: t.reasonAsk, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Amber, modifier = Modifier.weight(1f))
                        Box(Modifier.clickable { reasonFor = l.productId }) { Tag(if (l.reason == null) "?" else "✎", C.Amber, C.MarigoldWash) }
                    }
                }
                if (i < sheet.lines.lastIndex) HorizontalDivider(color = C.Line)
            }
        }
        if (done < sheet.lines.size) Text(t.left(sheet.lines.size - done), fontSize = 13.sp, color = C.Ink2, modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
        BigButton(t.submitCount, { s.submitCount(mic) }, color = C.Mint, enabled = s.countReady.first)
        TextButton({ confirmCancel = true }, Modifier.fillMaxWidth()) { Text(t.cancelCount, color = C.Brick) }
        Spacer(Modifier.height(40.dp))
    }
    if (confirmCancel) AlertDialog(onDismissRequest = { confirmCancel = false }, title = { Text(t.cancelCount) },
        confirmButton = { TextButton({ confirmCancel = false; s.cancelCount() }) { Text(t.cancelCount, color = C.Brick) } },
        dismissButton = { TextButton({ confirmCancel = false }) { Text(t.close) } })
    reasonFor?.let { pid ->
        val line = sheet.lines.firstOrNull { it.productId == pid }
        ModalBottomSheet(onDismissRequest = { reasonFor = null }, containerColor = C.Linen) {
            Column(Modifier.padding(20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(line?.let { "${it.name}: ${t.book} ${it.expectedQty} → ${t.counted} ${it.physicalQty ?: 0}" } ?: "", fontSize = 16.sp, fontWeight = FontWeight.Bold)
                Text(t.reasonAsk, fontSize = 14.sp, color = C.Ink2)
                listOf("COUNTING_ERROR", "UNRECORDED_ISSUE", "RECEIPT_OVERSIGHT", "DAMAGED", "EXPIRED", "OTHER").forEach { r ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(12.dp)).clickable { s.setCount(pid, line?.physicalQty, r); reasonFor = null }.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(t.reason(r), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        if (line?.reason == r) Icon(Icons.Filled.Check, null, tint = C.Mint)
                    }
                }
            }
        }
    }
}

// ---------- Deliveries ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeliveriesScreen(s: AppState) {
    val t = s.t
    var receiving by remember { mutableStateOf<Transfer?>(null) }
    var sendingTo by remember { mutableStateOf<Hotel?>(null) }
    var asking by remember { mutableStateOf(false) }
    var changing by remember { mutableStateOf<StockRequest?>(null) }
    val incoming = s.transfers.filter { it.toHotel.id == s.hotelId }
    val outgoing = s.transfers.filter { it.fromHotel.id == s.hotelId }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (s.isWarehouse) HotelsAskingPanel(s) { changing = it }
        else if (s.hasWarehouse) { FromWarehousePanel(s) { asking = true }; AutoAskPanel(s) }
        if (s.transfers.isEmpty()) Text(t.noOpenDeliveries, color = C.Ink2)
        if (incoming.isNotEmpty()) {
            Text(t.incoming, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            incoming.forEach { tr -> TransferCard(s, tr, incoming = true) { receiving = tr } }
        }
        if (outgoing.isNotEmpty()) {
            Text(t.outgoing, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            outgoing.forEach { tr -> TransferCard(s, tr, incoming = false) {} }
        }
        // Sending to another site. From the warehouse this is the main way out; between hotels it is tucked behind "Other hotels".
        val others = s.hotels.filter { it.id != s.hotelId && !it.isWarehouse }
        var showOthers by remember { mutableStateOf(s.isWarehouse || !s.hasWarehouse) }
        if (others.isNotEmpty()) {
            if (!showOthers) Text("${t.sendStock} · ${t.otherHotels} ›", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.clickable { showOthers = true }.padding(vertical = 4.dp))
            else Panel {
                Text(t.sendStock, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
                others.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEach { h -> PillButton(t.toHotel(h.name), Modifier.weight(1f)) { sendingTo = h } } } }
            }
        }
        if (s.recentTransfers.isNotEmpty()) {
            Text(t.lastWeek, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
            Panel {
                s.recentTransfers.forEach { tr ->
                    Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("✅", fontSize = 18.sp); Spacer(Modifier.width(10.dp))
                        Column {
                            Text("${tr.refCode} · ${tr.lines.joinToString { "${it.sent} ${it.name}" }}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text("${tr.fromHotel.name} → ${tr.toHotel.name} · ${if (tr.status == "RECEIVED") t.receivedInFull else tr.status}", fontSize = 12.sp, color = C.Ink2)
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(40.dp))
    }
    if (asking) AskSheet(s) { asking = false }
    changing?.let { SendRequestSheet(s, it) { changing = null } }
    receiving?.let { tr ->
        var qty by remember(tr.id) { mutableStateOf(tr.lines.associate { it.productId to (it.sent - it.received - it.resolvedShort) }) }
        var final by remember { mutableStateOf(true) }
        ModalBottomSheet(onDismissRequest = { receiving = null }, containerColor = C.Linen) {
            Column(Modifier.padding(20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${tr.refCode} · ${t.arrived}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                tr.lines.forEach { l ->
                    val outstanding = l.sent - l.received - l.resolvedShort
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text(l.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); Text("$outstanding ${t.sent}", fontSize = 12.sp, color = C.Ink2) }
                        Counter(qty[l.productId] ?: outstanding, 0, outstanding) { qty = qty + (l.productId to it) }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) { Switch(final, { final = it }); Spacer(Modifier.width(8.dp)); Text(t.thisIsAll, fontSize = 15.sp) }
                BigButton(t.done, { s.receiveSome(tr, qty, final); receiving = null }, color = C.Mint)
            }
        }
    }
    sendingTo?.let { h ->
        var qty by remember(h.id) { mutableStateOf<Map<String, Int>>(emptyMap()) }
        ModalBottomSheet(onDismissRequest = { sendingTo = null }, containerColor = C.Linen) {
            Column(Modifier.padding(20.dp).padding(bottom = 24.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("${t.sendStock} · ${t.toHotel(h.name)}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                s.stock.forEach { r ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(s.product(r.productId)?.emoji() ?: "📦", fontSize = 22.sp); Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) { Text(r.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); Text("${r.store}", fontSize = 12.sp, color = C.Ink2) }
                        Counter(qty[r.productId] ?: 0, 0, r.store) { qty = qty + (r.productId to it) }
                    }
                }
                BigButton(t.send, { s.dispatch(h.id, qty); sendingTo = null }, enabled = qty.values.any { it > 0 })
            }
        }
    }
}

@Composable
fun Counter(value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton({ onChange((value - 1).coerceAtLeast(min)) }, Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(20.dp))) { Icon(Icons.Filled.Remove, null, tint = C.Ink) }
        Text("$value", Modifier.widthIn(min = 44.dp), fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center)
        IconButton({ onChange((value + 1).coerceAtMost(max)) }, Modifier.size(40.dp).clip(RoundedCornerShape(20.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(20.dp))) { Icon(Icons.Filled.Add, null, tint = C.Ink) }
    }
}

@Composable
fun TransferCard(s: AppState, tr: Transfer, incoming: Boolean, onReceive: () -> Unit) {
    val t = s.t
    val short = tr.status == "DISCREPANCY"
    val partial = !short && tr.lines.any { it.received > 0 }
    Panel(border = if (short) C.Brick else if (tr.aged) C.Marigold else C.Line) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (incoming) "${tr.refCode} · ${tr.fromHotel.name} →" else "${tr.refCode} · → ${tr.toHotel.name}", fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
            when {
                short -> Tag(t.arrivedShort, C.Brick, Color(0xFFFBE9E5))
                partial -> Tag(t.partlyReceived, C.Amber, C.MarigoldWash)
                else -> Tag(t.notReceived(tr.ageHours.toInt()), if (tr.aged) C.Amber else C.Ink2, if (tr.aged) C.MarigoldWash else C.Linen)
            }
        }
        tr.lines.forEach { l ->
            Row {
                Text(l.name, fontSize = 14.sp, modifier = Modifier.weight(1f))
                Text("${l.sent} ${t.sent}", fontSize = 13.sp, color = C.Ink2)
                if (l.received > 0) Text(" · ${l.received} ${t.received}", fontSize = 13.sp, color = C.Mint)
                val miss = l.sent - l.received - l.resolvedShort
                if (miss > 0 && (short || l.received > 0)) Text(" · $miss ${t.missing}", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = C.Brick)
            }
        }
        if (incoming) {
            if (short) {
                Text(t.settle, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PillButton(t.settleLost, Modifier.weight(1f), filled = true, color = C.Brick) { s.settle(tr, "LOST") }
                    PillButton(t.settleDamaged, Modifier.weight(1f)) { s.settle(tr, "DAMAGED") }
                    PillButton(t.settleCountingError, Modifier.weight(1f)) { s.settle(tr, "COUNTING_ERROR") }
                }
            } else Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(t.receiveAll, Modifier.weight(1f), filled = true) { s.receiveAll(tr) }
                PillButton(t.receiveSome, Modifier.weight(1f)) { onReceive() }
            }
        }
    }
}

// ---------- Activity ----------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(s: AppState) {
    val t = s.t
    var reversing by remember { mutableStateOf<Event?>(null) }
    val today = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date())
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(t.changesToday(s.events.count { it.createdAt.isoMillis()?.let { m -> java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(java.util.Date(m)) == today } == true }), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
        s.corrections.forEach { c ->
            Panel(border = C.Marigold, bg = C.MarigoldWash) {
                Text(t.asksToCorrect(c.requestedByName ?: c.displayName ?: ""), fontSize = 15.sp, fontWeight = FontWeight.Bold)
                Text("“${c.note}”", fontSize = 14.sp, color = C.Ink2)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    s.eventFor(c)?.let { e -> PillButton(t.reverse, Modifier.weight(1f), filled = true, color = C.Brick) { reversing = e } }
                    PillButton(t.leaveAsIs, Modifier.weight(1f)) { s.dismiss(c) }
                }
            }
        }
        Panel {
            if (s.events.isEmpty()) Text(t.nothingYet, color = C.Ink2)
            s.events.forEachIndexed { i, e ->
                EventRow(s, e) { reversing = e }
                if (i < s.events.lastIndex) HorizontalDivider(color = C.Line)
            }
        }
        Spacer(Modifier.height(40.dp))
    }
    reversing?.let { e ->
        var reason by remember(e.eventId) { mutableStateOf("") }
        ModalBottomSheet(onDismissRequest = { reversing = null }, containerColor = C.Linen) {
            Column(Modifier.padding(20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(t.reverseNow, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                Text((e.lines ?: emptyList()).joinToString { "${it.quantity} ${it.name}" } + " · " + t.actionName(e.action), fontSize = 15.sp, color = C.Ink2)
                Text(t.whyReverse, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2)
                OutlinedTextField(reason, { reason = it }, Modifier.fillMaxWidth(), minLines = 2, maxLines = 4)
                Text(t.reverseNote, fontSize = 12.sp, color = C.Ink3)
                BigButton(t.reverseNow, { s.reverse(e, reason.trim()); reversing = null }, color = C.Brick, enabled = reason.trim().length >= 3)
            }
        }
    }
}

@Composable
fun EventRow(s: AppState, e: Event, onReverse: () -> Unit) {
    val t = s.t
    val icon = when (e.action) { "PLACE_IN_ROOM" -> "🛏️"; "CHECKOUT_TO_STAFF" -> "📦"; "RETURN_TO_STORE" -> "↩️"; "SUPPLIER_RECEIPT", "TRANSFER_RECEIPT" -> "🚚"; "TRANSFER_DISPATCH" -> "📤"; "REVERSAL" -> "⛔"; else -> "📋" }
    val dead = e.reversedBy != null
    val lines = e.lines ?: emptyList()
    Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.Top) {
        Text(icon, fontSize = 20.sp); Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(lines.joinToString { "${it.quantity} ${it.name}" } + (lines.firstOrNull()?.roomNumber?.let { " · ${t.actionName("PLACE_IN_ROOM")} $it" } ?: ""),
                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textDecoration = if (dead) TextDecoration.LineThrough else null)
            Text("${t.actionName(e.action)} · ${e.actor?.name ?: ""} · ${e.createdAt.hhmm()} · ${if (e.viaVoice) "🎤" else "⌨️"}" + (if (dead) " · ${t.reversed}" else ""), fontSize = 12.sp, color = C.Ink2)
            e.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 12.sp, color = C.Ink3) }
        }
        if (!dead && e.action != "REVERSAL" && e.reversalOf == null) Box(Modifier.clickable { onReverse() }) { Tag(t.reverse, C.Brick, Color(0xFFFBE9E5)) }
    }
}
