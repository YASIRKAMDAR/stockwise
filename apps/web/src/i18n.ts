export type Lang = 'en' | 'hi' | 'gu';
export type FlowKind = 'PLACE_IN_ROOM' | 'CHECKOUT_TO_STAFF' | 'RETURN_TO_STORE' | 'SUPPLIER_RECEIPT' | 'TRANSFER_DISPATCH';

const en = {
  youCanSay: 'You can say', voiceExamples: ['“Put two soaps in room 203”', '“Take ten soap from the store”', '“Return three shampoo”', '“Twenty soap arrived”', '“How many soap are left?”', '“My bag” · “History” · “Sign out”'],
  typeHere: 'Type: room 203, 2 soap', send: 'Send', 
  holdToTalk: 'Hold the mic and say what you did', releaseToSend: 'Release to send', slideToCancel: '◀ Slide to cancel', releaseToCancel: 'Release to cancel', holdHint: 'Keep holding the mic while you speak, then let go.', holdYesNo: 'Hold and say “yes” / “no”', cancelled: 'Cancelled',
  tapInstead: '✋ Tap instead', sayYesNo: 'or say “yes” / “no”', hearingYesNo: 'Listening for yes / no…', backHome: 'Back to start in a moment', twiceFailed: 'Didn’t catch that twice — let’s tap instead.', voiceUnavailable: 'Voice isn’t available on this phone. Tap instead.',
  home: 'Home', myStock: 'My bag', transfers: 'Transfers', activity: 'History',
  tapToSpeak: 'Tap and say what you did', listening: 'Listening… tap to stop', understanding: 'Understanding…',
  orTap: 'Or tap what you did',
  act: {
    PLACE_IN_ROOM: ['Put in room', 'From your bag or the store'],
    CHECKOUT_TO_STAFF: ['Take from store', 'Into your bag'],
    RETURN_TO_STORE: ['Return to store', 'From your bag'],
    SUPPLIER_RECEIPT: ['Stock arrived', 'From the supplier'],
    TRANSFER_DISPATCH: ['Send to hotel', 'To another hotel'],
    RECEIVE: ['Receive from hotel', 'Check what came'],
  } as Record<string, [string, string]>,
  q: {
    PLACE_IN_ROOM: 'What did you put in the room?', CHECKOUT_TO_STAFF: 'What did you take?', RETURN_TO_STORE: 'What are you returning?',
    SUPPLIER_RECEIPT: 'What arrived?', TRANSFER_DISPATCH: 'What are you sending?',
  } as Record<FlowKind, string>,
  whichRoom: 'Which room?', typeRoom: 'Type the room number', recentRooms: 'Recent rooms', whichHotel: 'Send to which hotel?',
  youHave: (n: number) => `You have ${n}`, inStore: (n: number) => `Store has ${n}`,
  next: 'Next', review: 'Check and confirm', confirm: 'Confirm', back: 'Back', cancel: 'Cancel',
  tapItems: 'Tap an item to add one. Tap again to add more.',
  room: 'Room', fromBag: 'From my bag', fromStore: 'From the store', chooseFrom: 'Where did these come from?',
  notEnough: (n: number) => `Not enough. Only ${n} available.`,
  saved: 'Saved', doAnother: 'Do another', goHome: 'Home', sameAgain: 'Same as last time', listen: 'Listen',
  roomNotFound: (n: string) => `Room ${n} is not in this hotel. Tap “Which room?”.`,
  chooseItem: 'Choose the item', heard: 'Heard', remove: 'Remove', change: 'Change',
  nothingCarried: 'You are not carrying anything.', nothingCarriedHint: 'Use “Take from store” when you pick up amenities.',
  incoming: 'Coming to this hotel', sent: 'Sent from this hotel', confirmReceived: 'Confirm what came', allCame: 'That is all that came',
  nothingIncoming: 'Nothing is on the way to this hotel.',
  recent: 'Recent', noRecent: 'Nothing recorded yet today.', signOut: 'Sign out', language: 'Language',
  micDenied: 'The microphone is blocked. Allow it in the browser, or tap what you did below.',
  voiceFailed: 'Could not understand. Try again, or tap what you did below.',
  stillAsking: 'Still asking Google…', googleSlow: 'Google didn’t answer in time.', sayAgain: 'Say it again', typeIt: 'Type it', tapToFix: 'Tap to correct',
  fromPhoneWords: 'Google was slow, so this is from what the phone heard. Check it.', noGuVoice: 'This phone has no Gujarati voice, so replies are read in Hindi.',
  offlineVoice: 'No signal. The phone will listen by itself; keep sentences short.', offlineVoiceNone: 'No signal, and this phone can’t listen by itself. Tap the buttons until you’re back online.',
  langTags: { gu: 'ગુજરાતી', hi: 'हिंदी', en: 'English', mixed: 'Mixed' } as Record<string, string>,
  offlineSaved: 'No connection. Saved on this phone — tap Retry when online.',
  notSubmitted: 'Not sent yet', retry: 'Retry', discard: 'Discard',
  pleaseCheck: 'Please check', reference: 'Reference',
  summary: (k: FlowKind, n: number, room?: string, hotel?: string) =>
    k === 'PLACE_IN_ROOM' ? `${n} ${n === 1 ? 'item' : 'items'} in room ${room ?? '…'}`
    : k === 'CHECKOUT_TO_STAFF' ? `${n} ${n === 1 ? 'item' : 'items'} from the store into your bag`
    : k === 'RETURN_TO_STORE' ? `${n} ${n === 1 ? 'item' : 'items'} back to the store`
    : k === 'SUPPLIER_RECEIPT' ? `${n} ${n === 1 ? 'item' : 'items'} arrived in the store`
    : `${n} ${n === 1 ? 'item' : 'items'} to ${hotel ?? '…'}`,
  examples: ['“Put two soaps in room 203”', '“Took 10 combs from the store”'],
};
type Dict = typeof en;

const gu: Dict = {
  ...en,
  youCanSay: 'તમે બોલી શકો', voiceExamples: ['“રૂમ 203 માં બે સાબુ મૂક્યા”', '“સ્ટોરમાંથી દસ સાબુ લીધા”', '“ત્રણ શેમ્પૂ પરત”', '“વીસ સાબુ આવ્યા”', '“કેટલા સાબુ બચ્યા?”', '“મારી બેગ” · “ઇતિહાસ” · “સાઇન આઉટ”'],
  typeHere: 'લખો: રૂમ 203, 2 સાબુ', send: 'મોકલો', 
  holdToTalk: 'માઇક દબાવી રાખો અને બોલો', releaseToSend: 'મોકલવા છોડો', slideToCancel: '◀ રદ કરવા ડાબે ખસેડો', releaseToCancel: 'રદ કરવા છોડો', holdHint: 'બોલો ત્યાં સુધી માઇક દબાવી રાખો, પછી છોડો.', holdYesNo: 'દબાવી રાખો અને બોલો “હા” / “ના”', cancelled: 'રદ થયું',
  tapInstead: '✋ દબાવીને કરો', sayYesNo: 'અથવા બોલો “હા” / “ના”', hearingYesNo: 'હા / ના સાંભળીએ છીએ…', backHome: 'થોડી વારમાં શરૂઆતમાં', twiceFailed: 'બે વાર સમજાયું નહીં — દબાવીને કરીએ.', voiceUnavailable: 'આ ફોનમાં અવાજ ચાલતો નથી. દબાવીને કરો.',
  home: 'હોમ', myStock: 'મારી બેગ', transfers: 'ટ્રાન્સફર', activity: 'ઇતિહાસ',
  tapToSpeak: 'ટૅપ કરીને બોલો તમે શું કર્યું', listening: 'સાંભળી રહ્યા છીએ… રોકવા ટૅપ કરો', understanding: 'સમજી રહ્યા છીએ…',
  orTap: 'અથવા તમે શું કર્યું તે પસંદ કરો',
  act: {
    PLACE_IN_ROOM: ['રૂમમાં મૂક્યું', 'બેગ કે સ્ટોરમાંથી'],
    CHECKOUT_TO_STAFF: ['સ્ટોરમાંથી લીધું', 'તમારી બેગમાં'],
    RETURN_TO_STORE: ['સ્ટોરમાં પાછું', 'તમારી બેગમાંથી'],
    SUPPLIER_RECEIPT: ['માલ આવ્યો', 'સપ્લાયર પાસેથી'],
    TRANSFER_DISPATCH: ['હોટેલને મોકલ્યું', 'બીજી હોટેલમાં'],
    RECEIVE: ['હોટેલથી આવ્યું', 'શું આવ્યું તે તપાસો'],
  },
  q: {
    PLACE_IN_ROOM: 'રૂમમાં શું મૂક્યું?', CHECKOUT_TO_STAFF: 'શું લીધું?', RETURN_TO_STORE: 'શું પાછું આપો છો?',
    SUPPLIER_RECEIPT: 'શું આવ્યું?', TRANSFER_DISPATCH: 'શું મોકલો છો?',
  },
  whichRoom: 'કયો રૂમ?', typeRoom: 'રૂમ નંબર દબાવો', recentRooms: 'તાજેતરના રૂમ', whichHotel: 'કઈ હોટેલને મોકલવું?',
  youHave: (n) => `તમારી પાસે ${n}`, inStore: (n) => `સ્ટોરમાં ${n}`,
  next: 'આગળ', review: 'તપાસો અને પુષ્ટિ કરો', confirm: 'પુષ્ટિ કરો', back: 'પાછળ', cancel: 'રદ કરો',
  tapItems: 'વસ્તુ ઉમેરવા ટૅપ કરો. વધુ માટે ફરી ટૅપ કરો.',
  room: 'રૂમ', fromBag: 'મારી બેગમાંથી', fromStore: 'સ્ટોરમાંથી', chooseFrom: 'આ ક્યાંથી લીધું?',
  notEnough: (n) => `પૂરતું નથી. ફક્ત ${n} છે.`,
  saved: 'નોંધાઈ ગયું', doAnother: 'બીજું નોંધો', goHome: 'હોમ', sameAgain: 'ગઈ વખત જેવું', listen: 'સાંભળો',
  roomNotFound: (n) => `રૂમ ${n} આ હોટેલમાં નથી. “કયો રૂમ?” દબાવો.`,
  chooseItem: 'વસ્તુ પસંદ કરો', heard: 'સાંભળ્યું', remove: 'કાઢો', change: 'બદલો',
  nothingCarried: 'તમારી પાસે કંઈ નથી.', nothingCarriedHint: 'વસ્તુ લો ત્યારે “સ્ટોરમાંથી લીધું” દબાવો.',
  incoming: 'આ હોટેલમાં આવી રહ્યું છે', sent: 'આ હોટેલથી મોકલ્યું', confirmReceived: 'જે આવ્યું તેની પુષ્ટિ કરો', allCame: 'આટલું જ આવ્યું',
  nothingIncoming: 'આ હોટેલમાં કંઈ આવી રહ્યું નથી.',
  recent: 'તાજેતરનું', noRecent: 'હજી કંઈ નોંધાયું નથી.', signOut: 'સાઇન આઉટ', language: 'ભાષા',
  micDenied: 'માઇક બંધ છે. બ્રાઉઝરમાં મંજૂરી આપો, અથવા નીચે પસંદ કરો.',
  voiceFailed: 'સમજાયું નહીં. ફરી બોલો, અથવા નીચે પસંદ કરો.',
  stillAsking: 'હજુ Google ને પૂછી રહ્યા છીએ…', googleSlow: 'Google એ સમયસર જવાબ ન આપ્યો.', sayAgain: 'ફરી બોલો', typeIt: 'લખો', tapToFix: 'સુધારવા દબાવો',
  fromPhoneWords: 'Google ધીમું હતું, એટલે આ ફોને જે સાંભળ્યું તેના પરથી છે. ચકાસો.', noGuVoice: 'આ ફોનમાં ગુજરાતી અવાજ નથી, એટલે જવાબ હિન્દીમાં વંચાશે.',
  offlineVoice: 'સિગ્નલ નથી. ફોન જાતે સાંભળશે; વાક્યો ટૂંકાં રાખો.', offlineVoiceNone: 'સિગ્નલ નથી, અને આ ફોન જાતે સાંભળી શકતો નથી. ઓનલાઇન થાઓ ત્યાં સુધી બટન દબાવો.',
  langTags: { gu: 'ગુજરાતી', hi: 'हिंदी', en: 'English', mixed: 'મિશ્ર' },
  offlineSaved: 'નેટવર્ક નથી. ફોનમાં સાચવ્યું — નેટ આવે ત્યારે ફરી પ્રયાસ દબાવો.',
  notSubmitted: 'હજી મોકલાયું નથી', retry: 'ફરી પ્રયાસ', discard: 'કાઢી નાખો',
  pleaseCheck: 'કૃપા કરી તપાસો', reference: 'સંદર્ભ',
  summary: (k, n, room, hotel) =>
    k === 'PLACE_IN_ROOM' ? `રૂમ ${room ?? '…'} માં ${n} વસ્તુ`
    : k === 'CHECKOUT_TO_STAFF' ? `સ્ટોરમાંથી ${n} વસ્તુ તમારી બેગમાં`
    : k === 'RETURN_TO_STORE' ? `${n} વસ્તુ સ્ટોરમાં પાછી`
    : k === 'SUPPLIER_RECEIPT' ? `${n} વસ્તુ સ્ટોરમાં આવી`
    : `${hotel ?? '…'} ને ${n} વસ્તુ`,
  examples: ['“રૂમ ૨૦૩ માં બે સાબુ મૂક્યા”', '“સ્ટોરમાંથી ૧૦ કાંસકા લીધા”'],
};

const hi: Dict = {
  ...en,
  youCanSay: 'आप बोल सकते हैं', voiceExamples: ['“रूम 203 में दो साबुन रखे”', '“स्टोर से दस साबुन लिए”', '“तीन शैम्पू वापस”', '“बीस साबुन आए”', '“कितने साबुन बचे?”', '“मेरा बैग” · “इतिहास” · “साइन आउट”'],
  typeHere: 'लिखें: रूम 203, 2 साबुन', send: 'भेजें', 
  holdToTalk: 'माइक दबाकर रखें और बोलें', releaseToSend: 'भेजने के लिए छोड़ें', slideToCancel: '◀ रद्द करने के लिए बाएँ खिसकाएँ', releaseToCancel: 'रद्द करने के लिए छोड़ें', holdHint: 'बोलते समय माइक दबाकर रखें, फिर छोड़ें।', holdYesNo: 'दबाकर रखें और बोलें “हाँ” / “नहीं”', cancelled: 'रद्द हुआ',
  tapInstead: '✋ दबाकर करें', sayYesNo: 'या बोलें “हाँ” / “नहीं”', hearingYesNo: 'हाँ / नहीं सुन रहे हैं…', backHome: 'थोड़ी देर में शुरुआत पर', twiceFailed: 'दो बार समझ नहीं आया — दबाकर करते हैं।', voiceUnavailable: 'इस फ़ोन पर आवाज़ नहीं चलती। दबाकर करें।',
  home: 'होम', myStock: 'मेरा बैग', transfers: 'ट्रांसफर', activity: 'इतिहास',
  tapToSpeak: 'टैप करके बताएं आपने क्या किया', listening: 'सुन रहे हैं… रोकने के लिए टैप करें', understanding: 'समझ रहे हैं…',
  orTap: 'या जो किया उसे चुनें',
  act: {
    PLACE_IN_ROOM: ['कमरे में रखा', 'बैग या स्टोर से'],
    CHECKOUT_TO_STAFF: ['स्टोर से लिया', 'अपने बैग में'],
    RETURN_TO_STORE: ['स्टोर में वापस', 'अपने बैग से'],
    SUPPLIER_RECEIPT: ['माल आया', 'सप्लायर से'],
    TRANSFER_DISPATCH: ['होटल को भेजा', 'दूसरे होटल में'],
    RECEIVE: ['होटल से आया', 'जो आया उसे जाँचें'],
  },
  q: {
    PLACE_IN_ROOM: 'कमरे में क्या रखा?', CHECKOUT_TO_STAFF: 'क्या लिया?', RETURN_TO_STORE: 'क्या वापस कर रहे हैं?',
    SUPPLIER_RECEIPT: 'क्या आया?', TRANSFER_DISPATCH: 'क्या भेज रहे हैं?',
  },
  whichRoom: 'कौन सा कमरा?', typeRoom: 'कमरा नंबर दबाएं', recentRooms: 'हाल के कमरे', whichHotel: 'किस होटल को भेजना है?',
  youHave: (n) => `आपके पास ${n}`, inStore: (n) => `स्टोर में ${n}`,
  next: 'आगे', review: 'जाँचें और पुष्टि करें', confirm: 'पुष्टि करें', back: 'पीछे', cancel: 'रद्द करें',
  tapItems: 'सामान जोड़ने के लिए टैप करें। ज़्यादा के लिए फिर टैप करें।',
  room: 'कमरा', fromBag: 'मेरे बैग से', fromStore: 'स्टोर से', chooseFrom: 'ये कहाँ से लिया?',
  notEnough: (n) => `पर्याप्त नहीं। केवल ${n} हैं।`,
  saved: 'दर्ज हो गया', doAnother: 'एक और दर्ज करें', goHome: 'होम', sameAgain: 'पिछली बार जैसा', listen: 'सुनें',
  roomNotFound: (n) => `कमरा ${n} इस होटल में नहीं है। “कौन सा कमरा?” दबाएं।`,
  chooseItem: 'सामान चुनें', heard: 'सुना', remove: 'हटाएं', change: 'बदलें',
  nothingCarried: 'आपके पास कुछ नहीं है।', nothingCarriedHint: 'सामान लेते समय “स्टोर से लिया” दबाएं।',
  incoming: 'इस होटल में आ रहा है', sent: 'इस होटल से भेजा', confirmReceived: 'जो आया उसकी पुष्टि करें', allCame: 'बस इतना ही आया',
  nothingIncoming: 'इस होटल में कुछ नहीं आ रहा।',
  recent: 'हाल का', noRecent: 'अभी कुछ दर्ज नहीं हुआ।', signOut: 'साइन आउट', language: 'भाषा',
  micDenied: 'माइक बंद है। ब्राउज़र में अनुमति दें, या नीचे चुनें।',
  voiceFailed: 'समझ नहीं आया। फिर बोलें, या नीचे चुनें।',
  stillAsking: 'अभी भी Google से पूछ रहे हैं…', googleSlow: 'Google ने समय पर जवाब नहीं दिया।', sayAgain: 'फिर से बोलें', typeIt: 'लिख दें', tapToFix: 'सुधारने के लिए दबाएँ',
  fromPhoneWords: 'Google धीमा था, इसलिए यह फ़ोन ने जो सुना उससे है। जाँच लें।', noGuVoice: 'इस फ़ोन में गुजराती आवाज़ नहीं है, इसलिए जवाब हिंदी में पढ़े जाएँगे।',
  offlineVoice: 'सिग्नल नहीं है। फ़ोन खुद सुनेगा; वाक्य छोटे रखें।', offlineVoiceNone: 'सिग्नल नहीं है, और यह फ़ोन खुद नहीं सुन सकता। ऑनलाइन होने तक बटन दबाएँ।',
  langTags: { gu: 'ગુજરાતી', hi: 'हिंदी', en: 'English', mixed: 'मिश्रित' },
  offlineSaved: 'नेटवर्क नहीं है। फ़ोन में सहेजा — नेट आने पर फिर कोशिश दबाएं।',
  notSubmitted: 'अभी भेजा नहीं गया', retry: 'फिर कोशिश', discard: 'हटा दें',
  pleaseCheck: 'कृपया जाँचें', reference: 'संदर्भ',
  summary: (k, n, room, hotel) =>
    k === 'PLACE_IN_ROOM' ? `कमरा ${room ?? '…'} में ${n} सामान`
    : k === 'CHECKOUT_TO_STAFF' ? `स्टोर से ${n} सामान आपके बैग में`
    : k === 'RETURN_TO_STORE' ? `${n} सामान स्टोर में वापस`
    : k === 'SUPPLIER_RECEIPT' ? `${n} सामान स्टोर में आया`
    : `${hotel ?? '…'} को ${n} सामान`,
  examples: ['“कमरा 203 में दो साबुन रखे”', '“Room 203 mein 2 soap rakhe”'],
};

export const DICTS: Record<Lang, Dict> = { en, hi, gu };
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' };
export const LANG_CODES: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' };
export type T = Dict;

/** Whether this phone can read aloud in the language. */
export function hasVoice(lang: Lang) {
  try { return !!window.speechSynthesis?.getVoices().some((x) => x.lang?.toLowerCase().startsWith(lang)); } catch { return false; }
}
/** Read text aloud in the language asked for; without a voice for it (common for Gujarati), Hindi, then English. */
export function speak(text: string, lang: Lang) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return false;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const pick: Lang = ([lang, 'hi', 'en'] as Lang[]).find(hasVoice) ?? lang;
    u.lang = LANG_CODES[pick];
    const v = synth.getVoices().find((x) => x.lang?.toLowerCase().startsWith(pick));
    if (v) u.voice = v;
    u.rate = 0.95;
    synth.speak(u);
    return true;
  } catch { return false; }
}
