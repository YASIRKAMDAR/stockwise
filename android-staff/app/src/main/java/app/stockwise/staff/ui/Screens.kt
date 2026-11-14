package app.stockwise.staff.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.stockwise.staff.*
import kotlinx.coroutines.launch
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Microphone permission + speech, provided by the Activity (fakes in screenshot tests). */
interface Mic {
    val available: Boolean
    fun hasPermission(): Boolean
    fun requestPermission()
    fun start(lang: String, onInterim: (String) -> Unit, onDone: (String?, Int?) -> Unit)
    fun release()
    fun cancel()
    fun say(text: String, lang: String)
}

@Composable
fun StaffApp(s: AppState, mic: Mic, drawerOpen: Boolean = false) {
    StaffTheme {
        Surface(Modifier.fillMaxSize(), color = C.Linen) {
            when {
                s.booting -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator(color = C.Indigo) }
                s.me == null -> LoginScreen(s)
                else -> Shell(s, mic, drawerOpen)
            }
        }
    }
}

@Composable
fun LoginScreen(s: AppState) {
    val t = s.t
    var code by remember { mutableStateOf(s.store.lastCode) }
    var pin by remember { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(C.Ink).padding(20.dp), contentAlignment = Alignment.Center) {
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(C.Paper).padding(22.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(C.Indigo), contentAlignment = Alignment.Center) { Text("✓", color = Color.White, fontSize = 24.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.width(12.dp))
                Column { Text("Stockwise", style = MaterialTheme.typography.headlineSmall); Text(t.tagline, style = MaterialTheme.typography.bodyMedium) }
            }
            LangRow(s)
            OutlinedTextField(code, { code = it.uppercase() }, label = { Text(t.yourCode) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii), textStyle = MaterialTheme.typography.titleLarge)
            OutlinedTextField(pin, { v -> pin = v.filter { it.isDigit() }.take(8) }, label = { Text(t.passcode) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), textStyle = MaterialTheme.typography.titleLarge)
            s.loginError?.let { Banner(it) }
            BigButton(if (s.busy) "…" else t.signIn, { s.login(code, pin) }, enabled = !s.busy && code.isNotBlank() && pin.length >= 4)
        }
    }
}

@Composable
fun LangRow(s: AppState) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp))) {
        listOf("gu" to "ગુજરાતી", "hi" to "हिन्दी", "en" to "English").forEach { (l, label) ->
            val on = s.lang == l
            Box(Modifier.weight(1f).height(48.dp).background(if (on) C.Ink else C.Paper).clickable { s.setLanguage(l) }, contentAlignment = Alignment.Center) {
                Text(label, color = if (on) Color.White else C.Ink2, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Shell(s: AppState, mic: Mic, drawerOpen: Boolean = false) {
    val t = s.t
    val drawer = rememberDrawerState(if (drawerOpen) DrawerValue.Open else DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    ModalNavigationDrawer(drawerState = drawer, drawerContent = {
        ModalDrawerSheet(drawerContainerColor = C.Paper) {
            Column(Modifier.padding(16.dp)) {
                Text(s.me?.displayName ?: "", style = MaterialTheme.typography.titleLarge)
                Text(s.hotel?.name ?: "", style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(color = C.Line)
            val go = { tab: Tab -> s.flow = null; s.tab = tab; if (tab == Tab.HISTORY) s.loadHistory(); if (tab == Tab.BAG) s.refresh(); scope.launch { drawer.close() } }
            NavigationDrawerItem(label = { Text(t.home, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.Home, null) }, selected = s.tab == Tab.HOME && s.flow == null, onClick = { go(Tab.HOME) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            NavigationDrawerItem(label = { Text(t.myBag, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.Inventory2, null) }, selected = s.tab == Tab.BAG && s.flow == null, onClick = { go(Tab.BAG) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            NavigationDrawerItem(label = { Text(t.history, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.Filled.History, null) }, selected = s.tab == Tab.HISTORY && s.flow == null, onClick = { go(Tab.HISTORY) }, modifier = Modifier.padding(horizontal = 8.dp), colors = NavigationDrawerItemDefaults.colors(selectedContainerColor = C.IndigoWash, selectedTextColor = C.Indigo, selectedIconColor = C.Indigo))
            HorizontalDivider(color = C.Line, modifier = Modifier.padding(vertical = 8.dp))
            Column(Modifier.padding(horizontal = 16.dp)) { Text(t.language, style = MaterialTheme.typography.bodyMedium); Spacer(Modifier.height(6.dp)); LangRow(s) }
            Spacer(Modifier.weight(1f))
            HorizontalDivider(color = C.Line)
            NavigationDrawerItem(label = { Text(t.signOut, color = C.Brick, style = MaterialTheme.typography.titleMedium) }, icon = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = C.Brick) }, selected = false,
                onClick = { scope.launch { drawer.close() }; s.signOut() }, modifier = Modifier.padding(8.dp))
        }
    }) {
        Column(Modifier.fillMaxSize().background(C.Linen).systemBarsPadding().imePadding()) {
            Row(Modifier.fillMaxWidth().background(C.Paper).padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(RoundedCornerShape(12.dp)).border(1.5.dp, C.Line, RoundedCornerShape(12.dp)).clickable { scope.launch { drawer.open() } }, contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.Menu, "Menu", tint = C.Ink)
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    val title = s.flow?.let { t.act(it.kind).first } ?: when (s.tab) { Tab.HOME -> s.hotel?.name ?: ""; Tab.BAG -> t.myBag; Tab.HISTORY -> t.history }
                    Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text("${s.me?.displayName ?: ""} · ${s.hotel?.name ?: ""}", style = MaterialTheme.typography.bodyMedium, fontSize = 13.sp, maxLines = 1)
                }
            }
            HorizontalDivider(color = C.Line)
            Box(Modifier.weight(1f)) {
                val f = s.flow
                when {
                    f != null -> FlowScreen(s, f, mic)
                    s.tab == Tab.HOME -> HomeScreen(s)
                    s.tab == Tab.BAG -> BagScreen(s)
                    else -> HistoryScreen(s)
                }
            }
            if (s.flow == null && s.tab == Tab.HOME) VoiceBar(s, mic)
        }
    }
}

/** Bottom bar on the home screen: hold the mic or type. */
@Composable
fun VoiceBar(s: AppState, mic: Mic) {
    val t = s.t
    var live by remember { mutableStateOf(false) }
    var startedAt by remember { mutableLongStateOf(0L) }
    var interim by remember { mutableStateOf("") }
    Composer(
        placeholder = t.typeHere, slideText = t.slideToCancel, releaseCancelText = t.releaseToCancel,
        live = live, startedAt = startedAt, interim = interim, busy = s.busy, micAvailable = mic.available,
        onText = { s.interpret(it, 0) },
        onStart = {
            if (!mic.hasPermission()) { mic.requestPermission(); return@Composer }
            s.notice = null; s.answer = null; interim = ""; startedAt = System.currentTimeMillis(); live = true
            mic.start(s.lang, { interim = it }) { text, err ->
                live = false
                when {
                    text == null && err == null -> {}                                   // cancelled
                    !text.isNullOrBlank() -> s.interpret(text, System.currentTimeMillis() - startedAt)
                    else -> s.missed()
                }
            }
        },
        onSend = { mic.release() },
        onCancel = { if (live) { mic.cancel(); live = false } },
        onTap = { s.notice = Notice(if (!mic.available) t.noVoice else if (!mic.hasPermission()) t.micDenied else t.holdHint) },
    )
}

@Composable
fun HomeScreen(s: AppState) {
    val t = s.t
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Panel {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(CircleShape).background(C.Marigold), contentAlignment = Alignment.Center) { Icon(Icons.Filled.Mic, null, tint = C.Ink) }
                Spacer(Modifier.width(14.dp))
                Column { Text(t.holdToTalk, style = MaterialTheme.typography.titleMedium); Text(t.example, style = MaterialTheme.typography.bodyMedium) }
            }
        }
        s.outbox.filter { it.error == null }.takeIf { it.isNotEmpty() }?.let { q ->
            Panel(border = C.Marigold, bg = C.MarigoldWash) {
                Text("${t.pending}: ${q.size}", fontWeight = FontWeight.Bold, color = C.Amber)
                q.take(3).forEach { Text(it.label, color = C.Amber) }
                Spacer(Modifier.height(6.dp)); BigButton(t.sendNow, { s.sendOutbox() }, color = C.Ink)
            }
        }
        s.outbox.filter { it.error != null }.forEach { p ->
            Panel(border = C.Brick) {
                Text(p.label, fontWeight = FontWeight.Bold); Text(p.error ?: "", color = C.Brick)
                TextButton({ s.discardPending(p.key) }) { Text("OK") }
            }
        }
        s.notice?.let { Banner(it.text, it.warn) }
        s.answer?.let { rows ->
            Panel {
                rows.forEach { r -> Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Text(r.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                    Text("${t.store} ${r.store}", Modifier.padding(end = 12.dp)); Text("👜 ${s.bag[r.productId] ?: 0}") } }
            }
        }
        BigButton(t.tapInstead, { s.tapInstead() }, outline = !s.nudgeTap, color = C.Ink)
        Text(t.orTap, style = MaterialTheme.typography.bodyMedium)
        JobTile(s, Kind.PLACE_IN_ROOM, primary = true)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            JobTile(s, Kind.CHECKOUT_TO_STAFF, Modifier.weight(1f)); JobTile(s, Kind.RETURN_TO_STORE, Modifier.weight(1f))
        }
        JobTile(s, Kind.SUPPLIER_RECEIPT)
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
fun JobTile(s: AppState, k: Kind, modifier: Modifier = Modifier, primary: Boolean = false) {
    val (title, sub) = s.t.act(k)
    val icon = when (k) { Kind.PLACE_IN_ROOM -> "🚪"; Kind.CHECKOUT_TO_STAFF -> "🛍️"; Kind.RETURN_TO_STORE -> "↩️"; Kind.SUPPLIER_RECEIPT -> "📦" }
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (primary) C.Indigo else C.Paper)
        .border(1.dp, if (primary) C.Indigo else C.Line, RoundedCornerShape(16.dp)).clickable { s.start(k) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 26.sp); Spacer(Modifier.width(12.dp))
        Column { Text(title, fontWeight = FontWeight.Bold, fontSize = 17.sp, color = if (primary) Color.White else C.Ink)
            Text(sub, fontSize = 13.sp, color = if (primary) Color(0xFFD9DDF5) else C.Ink3) }
    }
}

@Composable
fun BagScreen(s: AppState) {
    val t = s.t
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val items = s.bag.filter { it.value > 0 }
        if (items.isEmpty()) Panel { Text(t.nothingInBag) }
        items.forEach { (pid, q) -> val p = s.product(pid)
            Panel { Row(verticalAlignment = Alignment.CenterVertically) {
                Text(p?.emoji() ?: "📦", fontSize = 30.sp); Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) { Text(p?.name ?: "", style = MaterialTheme.typography.titleMedium); p?.native(s.lang)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) } }
                Text("$q", fontSize = 30.sp, fontWeight = FontWeight.Bold)
            } } }
        BigButton(s.t.act(Kind.RETURN_TO_STORE).first, { s.start(Kind.RETURN_TO_STORE) }, outline = true)
    }
}

@Composable
fun HistoryScreen(s: AppState) {
    val t = s.t
    val fmt = remember { DateTimeFormatter.ofPattern("dd MMM, HH:mm") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (s.history.isEmpty()) Panel { Text(t.noHistory) }
        s.history.forEach { e ->
            val k = Kind.of(e.action)
            Panel { Row {
                Column(Modifier.weight(1f)) {
                    Text((k?.let { t.act(it).first } ?: e.action) + if (e.viaVoice) " · 🎙" else "", style = MaterialTheme.typography.titleMedium)
                    Text(e.lines.orEmpty().joinToString(", ") { l -> "${l.quantity} ${l.name}" + (l.roomNumber?.let { " · ${t.room} $it" } ?: "") }, style = MaterialTheme.typography.bodyMedium)
                }
                Text(runCatching { OffsetDateTime.parse(e.createdAt).atZoneSameInstant(ZoneId.systemDefault()).format(fmt) }.getOrDefault(""), fontSize = 13.sp, color = C.Ink3, textAlign = TextAlign.End)
            } }
        }
    }
}
