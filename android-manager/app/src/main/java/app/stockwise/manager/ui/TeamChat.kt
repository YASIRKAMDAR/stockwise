package app.stockwise.manager.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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

// Talking inside the team happens here, not on WhatsApp: one thread per site, and the app adds a card when something happens.

@Composable
fun InboxScreen(s: AppState) {
    val t = s.t
    val threads = s.inbox?.threads ?: emptyList()
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(14.dp)) {
        if (threads.isEmpty()) item(key = "none") { Text(t.noMessages, color = C.Ink2) }
        items(threads, key = { it.siteId }) { th ->
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { s.openThread(th.siteId) }.padding(vertical = 10.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(th.siteName, 48)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(th.siteName, fontSize = 17.sp, fontWeight = if (th.unread > 0) FontWeight.Bold else FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val last = th.last
                    Text(if (last == null) t.noMessages else (if (last.kind == "TEXT" && last.author != null) last.author.substringBefore(' ') + ": " else "") + last.body.replace('\n', ' '),
                        fontSize = 14.sp, color = if (th.unread > 0) C.Ink else C.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(th.last?.createdAt?.hhmm() ?: "", fontSize = 12.sp, color = C.Ink3)
                    if (th.unread > 0) Box(Modifier.padding(top = 4.dp).size(24.dp).clip(CircleShape).background(C.Mint), contentAlignment = Alignment.Center) { Text("${th.unread}", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                }
            }
        }
    }
}

@Composable
fun ChatPage(s: AppState, p: Page.Chat) {
    val list = rememberLazyListState()
    val msgs = p.thread.messages
    LaunchedEffect(msgs.size) { if (msgs.isNotEmpty()) list.scrollToItem(msgs.size - 1) }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 12.dp), state = list, verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(vertical = 10.dp)) {
        if (msgs.isEmpty()) item(key = "none") { Text(s.t.noMessages, color = C.Ink2) }
        items(msgs, key = { it.id }) { m -> if (m.kind == "TEXT") TextBubble(m) else EventCard(s, p.thread, m) }
    }
}

@Composable
private fun TextBubble(m: Msg) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (m.mine) Arrangement.End else Arrangement.Start) {
        val shape = if (m.mine) RoundedCornerShape(18.dp, 18.dp, 4.dp, 18.dp) else RoundedCornerShape(18.dp, 18.dp, 18.dp, 4.dp)
        Column(Modifier.widthIn(max = 300.dp).clip(shape).background(if (m.mine) C.Indigo else C.Paper).border(1.dp, if (m.mine) C.Indigo else C.Line, shape).padding(horizontal = 14.dp, vertical = 9.dp)) {
            if (!m.mine && m.author != null) Text(m.author, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = C.Indigo)
            Text(m.body, fontSize = 16.sp, color = if (m.mine) Color.White else C.Ink)
            Text(m.createdAt?.hhmm() ?: "", fontSize = 11.sp, color = if (m.mine) Color.White.copy(alpha = 0.7f) else C.Ink3)
        }
    }
}

/** Something the app noted by itself. A request that is still open carries its buttons for the warehouse. */
@Composable
private fun EventCard(s: AppState, th: ChatThread, m: Msg) {
    val t = s.t
    val icon = when (m.kind) { "REQUEST" -> "📦"; "REQUEST_SENT" -> "🚚"; "REQUEST_DECLINED" -> "✋"; "ORDER_SENT" -> "🛒"; else -> "✅" }
    Panel(border = if (m.flagged) C.Brick else C.Line, bg = if (m.flagged) Color(0xFFFBE9E5) else C.Paper) {
        Row(verticalAlignment = Alignment.Top) {
            Text(icon, fontSize = 20.sp); Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(m.body, fontSize = 15.sp, color = C.Ink)
                Text(listOfNotNull(m.author, m.createdAt?.hhmm()).joinToString(" · "), fontSize = 11.sp, color = C.Ink3)
            }
        }
        if (m.kind == "REQUEST") when (m.refStatus) {
            "OPEN" -> if (th.canSend) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(t.packAndSend, Modifier.weight(1f), filled = true, color = C.Mint) { s.chatSend(m) }
                PillButton(t.sayNo, Modifier.weight(1f), color = C.Brick) { s.chatDecline(m) }
            } else Tag(t.waitingForWarehouse, C.Amber, C.MarigoldWash)
            "SENT" -> Tag(t.sentTag, Color(0xFF0F5C3C), C.MintWash)
            "RECEIVED" -> Tag(t.arrivedTag, Color(0xFF0F5C3C), C.MintWash)
            "DECLINED", "CANCELLED" -> Tag(t.notSentTag, C.Ink2, C.Linen)
            else -> {}
        }
    }
}
