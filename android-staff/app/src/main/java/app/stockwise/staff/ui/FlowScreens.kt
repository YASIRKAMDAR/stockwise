package app.stockwise.staff.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Backspace
import androidx.compose.material.icons.automirrored.filled.VolumeUp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.stockwise.staff.*
import kotlinx.coroutines.delay

@Composable
fun FlowScreen(s: AppState, f: Flow, mic: Mic) {
    when (f.step) {
        Step.ROOM -> RoomStep(s, f)
        Step.ITEMS -> ItemsStep(s, f)
        Step.CHECK -> CheckStep(s, f, mic)
        Step.DONE -> DoneStep(s, f)
    }
}

@Composable
private fun StepHead(s: AppState, f: Flow, title: String, onBack: () -> Unit) {
    val steps = if (f.kind.needsRoom) listOf(Step.ROOM, Step.ITEMS, Step.CHECK) else listOf(Step.ITEMS, Step.CHECK)
    val at = steps.indexOf(f.step)
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)).clickable(onClick = onBack), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back", tint = C.Ink)
            }
            Spacer(Modifier.width(12.dp))
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                steps.forEachIndexed { i, _ -> Box(Modifier.weight(1f).height(6.dp).clip(RoundedCornerShape(3.dp)).background(when { i < at -> C.Indigo; i == at -> C.Marigold; else -> C.Line })) }
            }
        }
        Text(title, style = MaterialTheme.typography.headlineSmall)
    }
}

@Composable
private fun RoomStep(s: AppState, f: Flow) {
    val t = s.t
    var entry by remember { mutableStateOf(f.roomNumber ?: "") }
    val exact = s.rooms.firstOrNull { it.roomNumber == entry }
    val recent = s.me?.let { s.store.recentRooms(it.id) }.orEmpty().filter { r -> s.rooms.any { it.roomNumber == r } }
    val matches = if (entry.isEmpty()) recent else s.rooms.map { it.roomNumber }.filter { it.startsWith(entry) }.take(6)
    val pick = { num: String -> s.rooms.firstOrNull { it.roomNumber == num }?.let { r -> s.flow = f.copy(step = Step.ITEMS, roomId = r.id, roomNumber = r.roomNumber) } }
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StepHead(s, f, t.whichRoom) { s.flow = null }
        Text(entry.ifEmpty { "—" }, Modifier.fillMaxWidth(), fontSize = 44.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, color = if (entry.isEmpty()) C.Line else C.Ink)
        Box(Modifier.fillMaxWidth().height(3.dp).background(C.Marigold))
        if (matches.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            matches.take(4).forEach { n -> Text("🚪 $n", Modifier.clip(RoundedCornerShape(999.dp)).background(if (n == entry) C.Indigo else C.Paper).border(1.5.dp, C.Line, RoundedCornerShape(999.dp)).clickable { pick(n) }.padding(horizontal = 14.dp, vertical = 8.dp),
                fontWeight = FontWeight.Bold, color = if (n == entry) Color.White else C.Ink) }
        }
        val keys = listOf("1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫")
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            keys.chunked(3).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { k -> Box(Modifier.weight(1f).height(60.dp).clip(RoundedCornerShape(14.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(14.dp))
                    .clickable { entry = when (k) { "C" -> ""; "⌫" -> entry.dropLast(1); else -> (entry + k).take(5) } }, contentAlignment = Alignment.Center) {
                    if (k == "⌫") Icon(Icons.AutoMirrored.Filled.Backspace, "Delete", tint = C.Ink) else Text(k, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                } }
            } }
        }
        Spacer(Modifier.weight(1f))
        BigButton(if (exact != null) "${t.next} · ${t.room} ${exact.roomNumber}" else t.next, { exact?.let { pick(it.roomNumber) } }, enabled = exact != null)
    }
}

@Composable
private fun ItemsStep(s: AppState, f: Flow) {
    val t = s.t
    val title = if (f.kind == Kind.PLACE_IN_ROOM) t.whatDidYouPut else t.whichItems
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StepHead(s, f, title) { s.flow = if (f.kind.needsRoom) f.copy(step = Step.ROOM) else null }
        if (f.roomNumber != null) Text("🚪 ${t.room} ${f.roomNumber}", Modifier.clip(RoundedCornerShape(999.dp)).background(C.Indigo).padding(horizontal = 12.dp, vertical = 6.dp), color = Color.White, fontWeight = FontWeight.Bold)
        Text(t.tapToAdd, style = MaterialTheme.typography.bodyMedium)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            s.active().chunked(2).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { p -> ProductTile(s, f, p, Modifier.weight(1f)) }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            } }
        }
        val n = f.cart.values.sum()
        BigButton(if (n > 0) "${t.check} · $n" else t.check, { s.cartToCheck() }, enabled = n > 0)
    }
}

@Composable
private fun ProductTile(s: AppState, f: Flow, p: Product, modifier: Modifier) {
    val q = f.cart[p.id] ?: 0
    val have = when (f.kind) { Kind.PLACE_IN_ROOM, Kind.RETURN_TO_STORE -> "👜 ${s.bag[p.id] ?: 0}"; Kind.CHECKOUT_TO_STAFF -> "${s.t.store} ${s.storeQty[p.id] ?: 0}"; else -> "" }
    Box(modifier.height(132.dp).clip(RoundedCornerShape(16.dp)).background(if (q > 0) C.IndigoWash else C.Paper)
        .border(2.dp, if (q > 0) C.Indigo else C.Line, RoundedCornerShape(16.dp)).clickable { s.flow = f.copy(cart = f.cart + (p.id to q + 1)) }) {
        Column(Modifier.fillMaxSize().padding(10.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(p.emoji(), fontSize = 34.sp)
            Text(p.name, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, maxLines = 1)
            p.native(s.lang)?.let { Text(it, fontSize = 13.sp, color = C.Ink2) }
            if (have.isNotEmpty()) Text(have, fontSize = 12.sp, color = C.Ink3)
        }
        if (q > 0) {
            Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(32.dp).clip(CircleShape).background(C.Indigo), contentAlignment = Alignment.Center) { Text("$q", color = Color.White, fontWeight = FontWeight.Bold) }
            Box(Modifier.align(Alignment.TopStart).padding(8.dp).size(32.dp).clip(CircleShape).background(C.Paper).border(1.dp, C.Line, CircleShape)
                .clickable { s.flow = f.copy(cart = if (q <= 1) f.cart - p.id else f.cart + (p.id to q - 1)) }, contentAlignment = Alignment.Center) { Text("−", fontWeight = FontWeight.Bold, fontSize = 18.sp) }
        }
    }
}

@Composable
private fun CheckStep(s: AppState, f: Flow, mic: Mic) {
    val t = s.t
    val fromVoice = f.proposalId != null
    val blocked = s.blocked(f)
    val sentence = s.summary(f)
    var hearing by remember { mutableStateOf(false) }
    LaunchedEffect(f.proposalId) {
        if (fromVoice && !blocked) mic.say(sentence + ". " + f.lines.joinToString(", ") { l -> "${l.quantity} ${s.product(l.productId)?.let { it.native(s.lang) ?: it.name } ?: ""}" }, s.lang)
    }
    val room = f.lines.firstOrNull { it.roomNumber != null }?.roomNumber
    Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        StepHead(s, f, t.check) { s.flow = if (fromVoice) null else f.copy(step = Step.ITEMS) }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (f.kind == Kind.PLACE_IN_ROOM && room != null) Row(verticalAlignment = Alignment.CenterVertically) {
                Text("🚪", fontSize = 34.sp); Spacer(Modifier.width(8.dp)); Text(room, fontSize = 48.sp, fontWeight = FontWeight.ExtraBold)
            }
            Panel {
                Row(verticalAlignment = Alignment.Top) {
                    Text(sentence, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                    IconButton({ mic.say(sentence, s.lang) }) { Icon(Icons.AutoMirrored.Filled.VolumeUp, "Read aloud", tint = C.Indigo) }
                }
                f.transcript?.let { Text("${t.heard}: “$it”", style = MaterialTheme.typography.bodyMedium, fontSize = 13.sp) }
            }
            f.lines.forEachIndexed { i, l -> LineCard(s, f, i, l) }
            s.notice?.let { Banner(it.text) }
        }
        if (fromVoice && !blocked && mic.available) Text(if (hearing) "● ${t.holdYesNo}" else t.holdYesNo, Modifier.fillMaxWidth(), textAlign = TextAlign.Center,
            color = if (hearing) C.Brick else C.Ink3, fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
            if (fromVoice && !blocked && mic.available) Box(Modifier.size(width = 64.dp, height = 58.dp).clip(RoundedCornerShape(16.dp)).background(if (hearing) C.Brick else C.Marigold)
                .holdToTalk(onStart = {
                    if (!mic.hasPermission()) { mic.requestPermission(); return@holdToTalk }
                    hearing = true
                    mic.start(s.lang, {}) { text, _ -> hearing = false
                        when (text?.let { yesNo(it) }) { true -> { s.confirm() }; false -> { s.flow = null }; null -> {} } }
                }, onSend = { mic.release() }, onCancel = { mic.cancel(); hearing = false }, onTap = { s.notice = Notice(t.holdHint) }),
                contentAlignment = Alignment.Center) { Icon(Icons.Filled.Mic, t.holdYesNo, tint = if (hearing) Color.White else C.Ink) }
            if (fromVoice) OutlinedButton({ s.flow = null }, Modifier.height(58.dp).width(64.dp), shape = RoundedCornerShape(16.dp), contentPadding = PaddingValues(0.dp)) { Icon(Icons.Filled.Close, "Cancel", tint = C.Ink) }
            Button({ s.confirm() }, Modifier.weight(1f).height(58.dp), enabled = !blocked && !s.busy, shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = C.Mint, disabledContainerColor = C.Line)) {
                Icon(Icons.Filled.Check, null); Spacer(Modifier.width(8.dp)); Text(if (s.busy) "…" else t.confirm, style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}

@Composable
private fun LineCard(s: AppState, f: Flow, i: Int, l: Line) {
    val t = s.t
    val p = s.product(l.productId)
    val set = { nl: Line -> s.flow = f.copy(lines = f.lines.mapIndexed { j, x -> if (j == i) nl else x }) }
    val short = when { p == null -> false
        f.kind == Kind.PLACE_IN_ROOM && l.source == "MY_STOCK" -> l.quantity > (s.bag[p.id] ?: 0)
        f.kind == Kind.PLACE_IN_ROOM && l.source == "STORE" -> l.quantity > (s.storeQty[p.id] ?: 0)
        f.kind == Kind.RETURN_TO_STORE -> l.quantity > (s.bag[p.id] ?: 0)
        f.kind == Kind.CHECKOUT_TO_STAFF -> l.quantity > (s.storeQty[p.id] ?: 0)
        else -> false }
    val flagged = p == null || short || (f.kind == Kind.PLACE_IN_ROOM && l.source == null) || l.issues.isNotEmpty()
    Panel(border = if (flagged) C.Marigold else C.Line, bg = if (flagged) Color(0xFFFFFBF2) else C.Paper) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(p?.emoji() ?: "❓", fontSize = 30.sp); Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                if (p != null) { Text(p.name, style = MaterialTheme.typography.titleMedium); p.native(s.lang)?.let { Text(it, fontSize = 13.sp, color = C.Ink2) } }
                else Text("${t.chooseItem} (“${l.spoken}”)", color = C.Amber, fontWeight = FontWeight.Bold)
                if (l.roomNumber != null) Text("${t.room} ${l.roomNumber}", fontSize = 13.sp, color = C.Indigo)
            }
            Stepper(l.quantity) { set(l.copy(quantity = it)) }
        }
        if (p == null) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            s.active().take(6).forEach { c -> Text(c.emoji(), Modifier.clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)).clickable { set(l.copy(productId = c.id, source = if (f.kind == Kind.PLACE_IN_ROOM) s.defaultSource(c.id, l.quantity) else null)) }.padding(10.dp), fontSize = 24.sp) }
        }
        if (f.kind == Kind.PLACE_IN_ROOM && p != null) Row(Modifier.padding(top = 10.dp).fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp))) {
            listOf("MY_STOCK" to "${t.fromBag} (${s.bag[p.id] ?: 0})", "STORE" to "${t.fromStore} (${s.storeQty[p.id] ?: 0})")
                .filter { it.first == "MY_STOCK" || s.hotel?.allowStoreToRoom != false }
                .forEach { (src, label) -> val on = l.source == src
                    Box(Modifier.weight(1f).height(48.dp).background(if (on) C.Indigo else C.Paper).clickable { set(l.copy(source = src)) }, contentAlignment = Alignment.Center) {
                        Text(label, color = if (on) Color.White else C.Ink, fontWeight = FontWeight.SemiBold, fontSize = 14.sp) } }
        }
        if (f.kind == Kind.PLACE_IN_ROOM && p != null && l.source == null) Text(t.chooseFrom, color = C.Amber, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
        if (short) Text("⚠ " + when (f.kind) { Kind.CHECKOUT_TO_STAFF -> "${t.store}: ${s.storeQty[p?.id] ?: 0}"; else -> "👜 ${s.bag[p?.id] ?: 0}" }, color = C.Brick, fontSize = 13.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Stepper(value: Int, onChange: (Int) -> Unit) {
    Row(Modifier.clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(46.dp).background(C.Linen).clickable { if (value > 1) onChange(value - 1) }, contentAlignment = Alignment.Center) { Text("−", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
        Text("$value", Modifier.width(44.dp), textAlign = TextAlign.Center, fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Box(Modifier.size(46.dp).background(C.Linen).clickable { onChange(value + 1) }, contentAlignment = Alignment.Center) { Text("+", fontSize = 22.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
private fun DoneStep(s: AppState, f: Flow) {
    val t = s.t
    val fromVoice = f.proposalId != null
    var left by remember { mutableFloatStateOf(1f) }
    LaunchedEffect(f) { if (fromVoice) { val steps = 35; repeat(steps) { delay(100); left = 1f - (it + 1f) / steps }; s.flow = null } }
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically)) {
        Box(Modifier.size(120.dp).clip(CircleShape).background(if (f.offline) C.Marigold else C.Mint), contentAlignment = Alignment.Center) {
            Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(64.dp))
        }
        Text(if (f.offline) t.pending else t.saved, style = MaterialTheme.typography.headlineSmall)
        Text(s.summary(f), style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (f.offline) Banner(t.savedOnPhone) else f.ref?.let { Text("Ref $it", color = C.Ink3) }
        if (fromVoice) { LinearProgressIndicator(progress = { left }, modifier = Modifier.fillMaxWidth(0.7f).height(6.dp), color = C.Mint, trackColor = C.Line); Text(t.backSoon, color = C.Ink3) }
        Spacer(Modifier.height(8.dp))
        BigButton(t.doAnother, { s.flow = Flow(f.kind, if (f.kind.needsRoom) Step.ROOM else Step.ITEMS) })
        BigButton(t.home, { s.flow = null }, outline = true)
    }
}
