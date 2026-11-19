package app.stockwise.manager.ui

import android.content.Intent
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Chat
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.FileProvider
import app.stockwise.manager.*
import java.io.File
import java.time.LocalDate

// Buying: suppliers kept like phone contacts, orders that go out on WhatsApp, and checking what arrives.

private val AVATARS = listOf(Color(0xFF2F3FA8), Color(0xFF1E9E6A), Color(0xFFB7791F), Color(0xFFC2413A), Color(0xFF6B4FBB), Color(0xFF0E7490))

/** The round letter picture a phone's contact list shows when there is no photo. */
@Composable
fun Avatar(name: String, size: Int = 44, square: Boolean = false) {
    val color = AVATARS[(name.hashCode() and 0x7fffffff) % AVATARS.size]
    Box(Modifier.size(size.dp).clip(if (square) RoundedCornerShape(10.dp) else CircleShape).background(color.copy(alpha = 0.14f)), contentAlignment = Alignment.Center) {
        Text(name.trim().take(1).uppercase(), color = color, fontWeight = FontWeight.Bold, fontSize = (size * 0.42f).sp)
    }
}

@Composable
fun SearchBox(value: String, hint: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    OutlinedTextField(value, onChange, modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(hint, color = C.Ink3) },
        leadingIcon = { Icon(Icons.Filled.Search, null, tint = C.Ink3) }, shape = RoundedCornerShape(26.dp),
        colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = C.Paper, unfocusedContainerColor = C.Paper, unfocusedBorderColor = C.Line))
}

/** A quantity you tap and type, so 100 or 200 is as quick as 2. Empty means none. */
@Composable
fun QtyBox(value: Int, unit: String, tag: String, modifier: Modifier = Modifier, onChange: (Int) -> Unit) {
    Row(modifier.clip(RoundedCornerShape(12.dp)).background(C.Paper).border(1.5.dp, if (value > 0) C.Indigo else C.Line, RoundedCornerShape(12.dp)).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(
            value = if (value == 0) "" else value.toString(),
            onValueChange = { v -> onChange(v.filter { it.isDigit() }.take(6).toIntOrNull() ?: 0) },
            modifier = Modifier.width(62.dp).testTag(tag), singleLine = true,
            textStyle = TextStyle(fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = C.Ink, textAlign = TextAlign.End),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            decorationBox = { inner -> Box(contentAlignment = Alignment.CenterEnd) { if (value == 0) Text("0", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = C.Line); inner() } },
        )
        if (unit.isNotBlank()) Text(" " + unit.lowercase(), fontSize = 13.sp, color = C.Ink2)
    }
}

@Composable
fun Pick(text: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(text, modifier.clip(RoundedCornerShape(20.dp)).background(if (on) C.Indigo else C.Paper).border(1.dp, if (on) C.Indigo else C.Line, RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 9.dp),
        fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (on) Color.White else C.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
}

@Composable
private fun Heading(text: String) { Text(text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2) }

// ---------- Suppliers: the list ----------

@Composable
fun SuppliersScreen(s: AppState) {
    val t = s.t
    val favourites = s.suppliers.filter { it.favourite }
    val groups = s.suppliers.groupBy { it.name.trim().take(1).uppercase().ifBlank { "#" } }.toList()
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 96.dp)) {
            item(key = "search") { SearchBox(s.supplierQuery, t.searchSuppliers) { s.searchSuppliers(it) } }
            if (favourites.isNotEmpty() && s.supplierQuery.isBlank()) {
                item(key = "fav") { LetterRow("★ " + t.favourites) }
                items(favourites, key = { "f" + it.id }) { SupplierRow(s, it) }
            }
            groups.forEach { (letter, list) ->
                item(key = "h$letter") { LetterRow(letter) }
                items(list, key = { it.id }) { SupplierRow(s, it) }
            }
            if (s.suppliers.isEmpty()) item(key = "none") { Text(if (s.supplierQuery.isBlank()) t.noSuppliers else t.nothingFound, Modifier.padding(top = 24.dp), color = C.Ink2) }
        }
        FloatingActionButton({ s.newSupplier() }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = C.Indigo, contentColor = Color.White) { Icon(Icons.Filled.Add, t.addSupplier) }
    }
}

@Composable
private fun LetterRow(text: String) { Text(text, Modifier.padding(top = 14.dp, bottom = 4.dp, start = 4.dp), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = C.Indigo) }

@Composable
private fun SupplierRow(s: AppState, sup: Supplier) {
    val t = s.t
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { s.openSupplier(sup.id) }.padding(vertical = 8.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(sup.name)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(sup.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val sub = (sup.categories.map { it.name } + listOfNotNull(if (sup.orders > 0) t.ordersCount(sup.orders) else null)).joinToString(" · ")
            if (sub.isNotBlank()) Text(sub, fontSize = 13.sp, color = C.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (!sup.phone.isNullOrBlank()) IconButton({ s.call(sup.phone) }) { Icon(Icons.Filled.Call, "${t.call} ${sup.name}", tint = C.Mint) }
    }
}

// ---------- Suppliers: one supplier ----------

@Composable
private fun Action(icon: ImageVector, label: String, tint: Color, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(48.dp).clip(CircleShape).background(tint.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) { Icon(icon, null, tint = tint) }
        Spacer(Modifier.height(4.dp))
        Text(label, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink)
    }
}

@Composable
fun SupplierCardPage(s: AppState, p: Page.SupplierCard) {
    val t = s.t
    val sup = p.supplier
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Avatar(sup.name, 84)
            Spacer(Modifier.height(8.dp))
            Text(sup.name, style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
            if (!sup.phone.isNullOrBlank()) Text(sup.phone, fontSize = 15.sp, color = C.Ink2)
        }
        Row(Modifier.fillMaxWidth()) {
            Action(Icons.Filled.Call, t.call, C.Mint, Modifier.weight(1f)) { s.call(sup.phone) }
            Action(Icons.Filled.Chat, "WhatsApp", C.Mint, Modifier.weight(1f)) { s.whatsapp(sup.phone) }
            Action(Icons.Filled.ShoppingCart, t.order, C.Indigo, Modifier.weight(1f)) { s.startOrder(NamedRef(sup.id, sup.name)) }
            Action(if (sup.favourite) Icons.Filled.Star else Icons.Filled.StarBorder, t.favourite, C.Marigold, Modifier.weight(1f)) { s.toggleFavourite(sup) }
        }
        Panel {
            Heading(t.sells)
            sup.categories.forEach { c ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable { s.openSupplierItems(sup, c) }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(c.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                        Text(if (c.allItems) t.everything else t.pickedItems(c.picked), fontSize = 13.sp, color = C.Ink2)
                    }
                    if (c.boughtBefore) Tag(t.boughtBefore, Color(0xFF0F5C3C), C.MintWash)
                    Text("  ›", fontSize = 20.sp, color = C.Ink3)
                }
            }
            val rest = s.categories.filter { c -> sup.categories.none { it.id == c.id } }
            if (rest.isNotEmpty()) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                rest.forEach { c -> Pick("+ " + c.shortName.ifBlank { c.name }, false) { s.addSupplierCategory(sup, c.id) } }
            }
        }
        if (sup.recentOrders.isNotEmpty()) Panel {
            Heading(t.recentOrders)
            sup.recentOrders.forEach { o ->
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("#${o.number}", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = C.Ink2); Spacer(Modifier.width(10.dp))
                    Text(o.items ?: "", Modifier.weight(1f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text((o.sentAt ?: o.createdAt ?: "").take(10), fontSize = 12.sp, color = C.Ink3)
                }
            }
        }
        if (sup.boughtMost.isNotEmpty()) Panel {
            Heading(t.boughtMost)
            sup.boughtMost.forEach { b ->
                Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(b.name, 32, square = true); Spacer(Modifier.width(10.dp))
                    Text(b.name, Modifier.weight(1f), fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("×${b.times}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = C.Ink2)
                }
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

/** Within one category: everything, or only the ticked items. */
@Composable
fun SupplierItemsPage(s: AppState, p: Page.SupplierItems) {
    val t = s.t
    var all by remember(p) { mutableStateOf(p.cat.allItems) }
    var picked by remember(p) { mutableStateOf<Set<String>>(p.items.filter { it.picked }.map { it.id }.toSet()) }
    Column(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "head") {
                Text("${p.supplier.name} · ${p.cat.name}", style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Pick(t.everything, all) { all = true }; Pick(t.onlySome, !all) { all = false } }
            }
            if (!all) items(p.items, key = { it.id }) { i ->
                val on = i.id in picked
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.Paper).border(1.dp, if (on) C.Indigo else C.Line, RoundedCornerShape(12.dp)).clickable { picked = if (on) picked - i.id else picked + i.id }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(on, null)
                    Spacer(Modifier.width(10.dp))
                    Text(i.name, Modifier.weight(1f), fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    if (i.boughtBefore) Tag(t.boughtBefore, Color(0xFF0F5C3C), C.MintWash)
                }
            }
        }
        BigButton(t.save, { s.saveSupplierItems(p.supplier, p.cat, all, picked.toList()) }, Modifier.padding(14.dp))
    }
}

@Composable
fun SupplierAddPage(s: AppState) {
    val t = s.t
    val ctx = LocalContext.current
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var cats by remember { mutableStateOf<Set<String>>(emptySet()) }
    // The phone's own contact picker: the person chooses one contact and only that one is read.
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val uri = res.data?.data
        if (uri != null) runCatching {
            ctx.contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { c ->
                if (c.moveToFirst()) { name = c.getString(0) ?: name; phone = c.getString(1) ?: phone }
            }
        }
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            BigButton(t.fromContacts, { runCatching { pick.launch(Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI)) } }, outline = true)
            OutlinedTextField(name, { name = it.take(80) }, Modifier.fillMaxWidth(), label = { Text(t.name) }, singleLine = true, textStyle = MaterialTheme.typography.titleLarge)
            OutlinedTextField(phone, { v -> phone = v.filter { it.isDigit() || it == '+' || it == ' ' }.take(20) }, Modifier.fillMaxWidth(), label = { Text(t.phone) }, singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), textStyle = MaterialTheme.typography.titleLarge)
            Heading(t.whatTheySell)
            s.categories.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { c -> Pick(c.shortName.ifBlank { c.name }, c.id in cats, Modifier.weight(1f)) { cats = if (c.id in cats) cats - c.id else cats + c.id } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        BigButton(t.save, { s.saveSupplier(name, phone, cats.toList()) }, Modifier.padding(14.dp), enabled = name.trim().length >= 2)
    }
}

// ---------- Orders ----------

/** What needs doing with suppliers: deliveries to check, orders written but not sent, items running low, lots to use first. */
@Composable
fun BuyingPanels(s: AppState, full: Boolean) {
    val t = s.t
    val h = s.home ?: return
    if (h.deliveriesDue.isNotEmpty() || full) Panel {
        Heading(t.deliveriesToCheck)
        if (h.deliveriesDue.isEmpty()) Text(t.nothingToCheck, fontSize = 14.sp, color = C.Ink3)
        h.deliveriesDue.forEach { o -> OrderRow("🚚", o) { PillButton(t.check, filled = true, color = C.Mint) { s.openOrder(o) } } }
    }
    if (h.drafts.isNotEmpty()) Panel(border = C.Marigold) {
        Heading(t.notSentYet)
        h.drafts.forEach { o -> OrderRow("📝", o) { PillButton(t.open) { s.openOrder(o) } } }
    }
    if (h.low.isNotEmpty() && (full || s.isWarehouse)) Panel {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t.runningLow, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Ink2, modifier = Modifier.weight(1f))
            PillButton(t.order, filled = true, color = C.Indigo) { s.startOrder(null) }
        }
        h.low.take(6).forEach { l ->
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Avatar(l.name, 32, square = true); Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(l.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(t.haveMin(l.store, l.min), fontSize = 12.sp, color = C.Brick)
                }
            }
        }
        if (h.low.size > 6) Text("+${h.low.size - 6}", fontSize = 12.sp, color = C.Ink3, modifier = Modifier.padding(top = 6.dp))
    }
    if (h.useFirst.isNotEmpty()) Panel(border = C.Marigold, bg = C.MarigoldWash) {
        Heading(t.useFirst)
        h.useFirst.take(6).forEach { u ->
            Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(u.name, Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${u.quantity} ${u.unit.lowercase()} · ${t.daysLeft(u.days)}", fontSize = 13.sp, color = C.Amber)
            }
        }
    }
}

@Composable
private fun OrderRow(icon: String, o: OrderSummary, action: @Composable () -> Unit) {
    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(icon, fontSize = 20.sp); Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(o.supplier.name, fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(o.names ?: "", fontSize = 13.sp, color = C.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.width(8.dp))
        action()
    }
}

@Composable
fun OrdersScreen(s: AppState) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        BigButton(s.t.newOrder, { s.startOrder(null) })
        BuyingPanels(s, full = true)
        Spacer(Modifier.height(40.dp))
    }
}

@Composable
fun OrderFormPage(s: AppState, p: Page.OrderForm) {
    val t = s.t
    val sup = p.supplier
    if (sup == null) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
            Text(t.whichSupplier, style = MaterialTheme.typography.titleLarge)
            Spacer(Modifier.height(6.dp))
            s.suppliers.sortedByDescending { it.favourite }.forEach { x ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { s.startOrder(NamedRef(x.id, x.name), p.lines, p.source) }.padding(vertical = 8.dp, horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(x.name); Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(x.name, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(x.categories.joinToString(" · ") { it.name }, fontSize = 13.sp, color = C.Ink2, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
            }
            if (s.suppliers.isEmpty()) Text(t.noSuppliers, color = C.Ink2)
        }
        return
    }
    var q by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(t.orderFrom(sup.name), style = MaterialTheme.typography.titleLarge)
            Text(t.orderHint, fontSize = 13.sp, color = C.Ink2)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (p.lines.any { it.last != null }) Chip(t.sameAsLast) { s.sameAsLast() }
                if (p.lines.any { it.fill > 0 }) Chip(t.fillUp) { s.fillUp() }
                if (p.lines.any { it.qty > 0 }) Chip(t.clear) { s.clearQty() }
            }
            SearchBox(q, t.addAnItem) { q = it; s.findItems(it) }
            s.found.take(6).forEach { i ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.IndigoWash).clickable { s.addOrderItem(i); q = "" }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("+ " + i.name, Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = C.Indigo, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(i.unit.lowercase(), fontSize = 13.sp, color = C.Ink2)
                }
            }
            p.lines.forEach { l ->
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Paper).border(1.dp, C.Line, RoundedCornerShape(14.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(l.name, 36, square = true); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text(l.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(t.haveLast(l.store, l.last), fontSize = 12.sp, color = C.Ink2)
                    }
                    Spacer(Modifier.width(8.dp))
                    QtyBox(l.qty, l.unit, "qty-${l.productId}") { s.setQty(l.productId, it) }
                }
            }
        }
        BigButton(t.sendToSupplier, { s.saveOrder() }, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), enabled = p.lines.any { it.qty > 0 })
    }
}

/** The message exactly as the supplier will read it, before anything is sent. */
@Composable
fun MessagePage(s: AppState, p: Page.Message) {
    val t = s.t
    val o = p.order
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Avatar(o.supplier.name); Spacer(Modifier.width(12.dp))
                Column {
                    Text(o.supplier.name, style = MaterialTheme.typography.titleLarge)
                    Text(o.supplier.phone ?: t.noPhone, fontSize = 13.sp, color = C.Ink2)
                }
            }
            Heading(t.messagePreview)
            Text(o.message, Modifier.fillMaxWidth().clip(RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp)).background(Color(0xFFDCF8C6)).padding(14.dp), fontSize = 16.sp, color = C.Ink)
            Box(Modifier.clickable { s.editOrder(o) }.padding(vertical = 6.dp)) { Text(t.changeOrder, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = C.Indigo) }
        }
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            BigButton(t.sendOnWhatsapp, { s.sendOrder(o, byCall = false) }, color = C.Mint)
            BigButton(t.callInstead, { s.sendOrder(o, byCall = true) }, outline = true)
        }
    }
}

// ---------- Checking a delivery ----------

@Composable
fun CheckPage(s: AppState, p: Page.Check) {
    val t = s.t
    val o = p.order
    val ctx = LocalContext.current
    val todo = o.lines.filter { it.quantity - it.received > 0 }
    // Everything starts as "all of it came": the common case needs no typing at all.
    val got = remember(o.id) { mutableStateMapOf<String, Int>().apply { todo.forEach { put(it.productId, it.quantity - it.received) } } }
    val bad = remember(o.id) { mutableStateMapOf<String, Int>() }
    val why = remember(o.id) { mutableStateMapOf<String, String>() }
    val useBy = remember(o.id) { mutableStateMapOf<String, String>() }
    val price = remember(o.id) { mutableStateMapOf<String, String>() }
    val wrong = remember(o.id) { mutableStateMapOf<String, Boolean>() }
    val read = s.bill
    // A bill that was read fills the boxes; a price that differs from the order opens that line so it is seen.
    LaunchedEffect(read) {
        read?.lines?.forEach { b ->
            val l = todo.firstOrNull { it.productId == b.productId } ?: return@forEach
            got[b.productId] = b.quantity
            val p = b.unitPrice
            if (p != null && l.unitPrice != null && kotlin.math.abs(p - l.unitPrice) > l.unitPrice * 0.02) { price[b.productId] = p.toString(); wrong[b.productId] = true }
        }
    }
    var pending by rememberSaveable { mutableStateOf("") }   // "KIND|path" of the photo being taken
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val parts = pending.split("|", limit = 2); pending = ""
        if (ok && parts.size == 2) s.addPhoto(parts[0], File(parts[1]))
    }
    val snap: (String) -> Unit = { kind ->
        val f = File(ctx.cacheDir, "photo-${System.currentTimeMillis()}.jpg")
        pending = "$kind|${f.path}"
        if (runCatching { camera.launch(FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)) }.isFailure) s.notice = Notice(t.noCamera)
    }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("${o.supplier.name} · #${o.number}", style = MaterialTheme.typography.titleLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PhotoButton(t.photoBill, s.photos.count { it.first == "BILL" }, Modifier.weight(1f)) { snap("BILL") }
                PhotoButton(t.photoGoods, s.photos.count { it.first == "GOODS" }, Modifier.weight(1f)) { snap("GOODS") }
            }
            if (s.reading) Banner(t.readingBill, warn = false)
            if (read != null) {
                Banner(t.billRead, warn = false)
                if (read.extras.isNotEmpty()) Text(t.alsoOnBill + ": " + read.extras.joinToString { it.name + (it.quantity?.let { q -> " " + q.toString().removeSuffix(".0") } ?: "") }, fontSize = 13.sp, color = C.Amber)
            }
            todo.forEach { l ->
                val id = l.productId
                val isWrong = wrong[id] == true
                Panel(border = if (isWrong) C.Marigold else C.Line) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(l.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                            Text(t.ordered(l.quantity - l.received, l.unit.lowercase()), fontSize = 12.sp, color = C.Ink2)
                            if (read != null && id in read.missing) Tag(t.notOnBill, C.Amber, C.MarigoldWash)
                        }
                        Text(t.came + " ", fontSize = 13.sp, color = C.Ink2)
                        QtyBox(got[id] ?: 0, l.unit, "got-$id") { got[id] = it }
                    }
                    if (l.hasExpiry) {
                        Text(t.useBy + (useBy[id]?.let { " · $it" } ?: ""), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = if (useBy[id] == null) C.Brick else C.Ink2, modifier = Modifier.padding(top = 8.dp))
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            val today = LocalDate.now()
                            listOf(t.d3 to today.plusDays(3), t.w1 to today.plusWeeks(1), t.m1 to today.plusMonths(1), t.m6 to today.plusMonths(6)).forEach { (label, day) ->
                                Pick(label, useBy[id] == day.toString()) { useBy[id] = day.toString() }
                            }
                        }
                    }
                    if (!isWrong) Box(Modifier.padding(top = 8.dp).clickable { wrong[id] = true }) { Text(t.somethingWrong, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Indigo) }
                    else {
                        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(t.sentBack, Modifier.weight(1f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                            QtyBox(bad[id] ?: 0, l.unit, "bad-$id") { bad[id] = it }
                        }
                        Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            t.reasons.forEach { (key, label) -> Pick(label, why[id] == key) { why[id] = key } }
                        }
                        OutlinedTextField(price[id] ?: "", { v -> price[id] = v.filter { it.isDigit() || it == '.' }.take(9) }, Modifier.fillMaxWidth().padding(top = 8.dp), label = { Text(t.newPrice) }, singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                    }
                }
            }
        }
        BigButton(if (s.busy) "…" else t.addToStock, {
            val lines = todo.map { l ->
                val back = bad[l.productId] ?: 0
                DeliveryLineBody(l.productId, got[l.productId] ?: 0, back, if (back > 0) why[l.productId] else null, price[l.productId]?.toDoubleOrNull(), if (l.hasExpiry) useBy[l.productId] else null)
            }.filter { it.received > 0 || it.rejected > 0 }
            when {
                todo.any { it.hasExpiry && (got[it.productId] ?: 0) > 0 && useBy[it.productId] == null } -> s.notice = Notice(t.needUseBy)
                lines.any { it.rejected > 0 && it.rejectReason == null } -> s.notice = Notice(t.needReason)
                else -> s.submitCheck(o, lines)
            }
        }, Modifier.padding(horizontal = 14.dp, vertical = 8.dp), enabled = !s.busy, color = C.Mint)
    }
}

@Composable
private fun PhotoButton(label: String, count: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Row(modifier.clip(RoundedCornerShape(14.dp)).background(if (count > 0) C.MintWash else C.Paper).border(1.dp, if (count > 0) C.Mint else C.Line, RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.PhotoCamera, null, tint = if (count > 0) C.Mint else C.Ink2)
        Spacer(Modifier.width(8.dp))
        Text(label + if (count > 0) " ✓ $count" else "", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = C.Ink, maxLines = 2)
    }
}

// ---------- Stock at the warehouse: the whole item list ----------

@Composable
fun CatalogStockScreen(s: AppState) {
    val t = s.t
    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 14.dp, end = 14.dp, top = 10.dp, bottom = 96.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            item(key = "search") { SearchBox(s.itemQuery, t.searchItems) { s.searchItems(it) } }
            items(s.items, key = { it.id }) { i ->
                val low = i.status == "LOW"
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(C.Paper).border(1.dp, if (low) C.Brick else C.Line, RoundedCornerShape(14.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Avatar(i.name, 44, square = true); Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(i.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            if (low) Tag(t.low, C.Brick, Color(0xFFFBE9E5))
                            if (i.status == "USE_FIRST") Tag(t.useFirst, C.Amber, C.MarigoldWash)
                            i.supplier?.let { Tag(it.name + if (it.more > 0) " +${it.more}" else "", C.Ink2, C.Linen) }
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    Column(horizontalAlignment = Alignment.End) {
                        Text("${i.store}", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = if (low) C.Brick else C.Ink)
                        Text(i.unit.lowercase(), fontSize = 12.sp, color = C.Ink2)
                    }
                }
            }
            if (s.items.isEmpty()) item(key = "none") { Text(t.nothingFound, Modifier.padding(top = 24.dp), color = C.Ink2) }
        }
        FloatingActionButton({ s.newItem() }, Modifier.align(Alignment.BottomEnd).padding(18.dp), containerColor = C.Indigo, contentColor = Color.White) { Icon(Icons.Filled.Add, t.addItem) }
    }
}

@Composable
fun AddItemPage(s: AppState) {
    val t = s.t
    var name by rememberSaveable { mutableStateOf("") }
    var unit by rememberSaveable { mutableStateOf("PCS") }
    var cat by rememberSaveable { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it.take(80) }, Modifier.fillMaxWidth(), label = { Text(t.name) }, singleLine = true, textStyle = MaterialTheme.typography.titleLarge)
            PillButton(if (s.lookingUp) t.searching else t.findOnWeb, enabled = name.trim().length >= 3 && !s.lookingUp) { s.lookupItem(name) }
            s.webOptions?.let { found ->
                Text(if (found.isEmpty()) t.webNothing else t.pickOne, fontSize = 13.sp, color = C.Ink2)
                found.forEach { o ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(C.IndigoWash).clickable { name = o.name; unit = o.unit }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(o.name, Modifier.weight(1f), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = C.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Text(listOfNotNull(o.unit.lowercase(), o.approxPrice?.let { t.about(it.toInt()) }).joinToString(" · "), fontSize = 13.sp, color = C.Ink2)
                    }
                }
            }
            Heading(t.unit)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("PCS", "KG", "LTR", "PKT", "BOX", "BTL").forEach { u -> Pick(u.lowercase(), unit == u) { unit = u } }
            }
            Heading(t.category)
            s.categories.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { c -> Pick(c.shortName.ifBlank { c.name }, cat == c.id, Modifier.weight(1f)) { cat = c.id } }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        BigButton(t.save, { s.addItem(name, unit, cat.ifBlank { null }) }, Modifier.padding(14.dp), enabled = name.trim().length >= 2)
    }
}

// ---------- A spoken order, waiting for Discard / Edit / Confirm ----------

@Composable
fun DraftCard(s: AppState, m: ChatMessage, b: ChatBody.Draft) {
    val t = s.t
    val d = b.draft
    AppBubble(warn = !d.ready && b.state == "OPEN") {
        Text(d.supplier?.let { t.orderFrom(it.name) } ?: t.whichSupplier, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = C.Ink)
        d.lines.forEach { l ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(l.match?.name ?: "“${l.heard}”", fontSize = 16.sp, color = if (l.match == null) C.Brick else C.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    if (l.unsure) Text(t.pleaseCheck(l.heard), fontSize = 12.sp, color = C.Amber)
                }
                Text(l.quantity?.let { "$it ${l.match?.unit?.lowercase() ?: ""}" } ?: "?", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = C.Ink)
            }
        }
        when (b.state) {
            "OPEN" -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(t.discard, Modifier.weight(1f), color = C.Brick) { s.discardDraft(m) }
                PillButton(t.edit, Modifier.weight(1f)) { s.editDraft(m) }
                PillButton(t.confirm, Modifier.weight(1f), filled = true, color = C.Mint, enabled = d.ready) { s.confirmDraft(m) }
            }
            "DISCARDED" -> Text(t.discarded, fontSize = 13.sp, color = C.Ink3)
            else -> Text("✓ " + t.saved, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = C.Mint)
        }
    }
}

@Composable
fun PageScreen(s: AppState, p: Page) {
    when (p) {
        is Page.SupplierCard -> SupplierCardPage(s, p)
        is Page.SupplierAdd -> SupplierAddPage(s)
        is Page.SupplierItems -> SupplierItemsPage(s, p)
        is Page.OrderForm -> OrderFormPage(s, p)
        is Page.Message -> MessagePage(s, p)
        is Page.Check -> CheckPage(s, p)
        is Page.AddItem -> AddItemPage(s)
    }
}

fun pageTitle(t: T, p: Page): String = when (p) {
    is Page.SupplierCard, is Page.SupplierItems -> t.suppliers
    is Page.SupplierAdd -> t.addSupplier
    is Page.OrderForm -> t.newOrder
    is Page.Message -> t.sendToSupplier
    is Page.Check -> t.checkDelivery
    is Page.AddItem -> t.addItem
}
