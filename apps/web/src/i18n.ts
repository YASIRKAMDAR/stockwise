export type Lang = 'en' | 'hi' | 'gu';
const en = {
  speak: 'Speak', myStock: 'My stock', transfers: 'Transfers', activity: 'Activity',
  tapAndTell: 'Tap and tell us what you took or placed.', recording: 'Recording… tap to stop', understanding: 'Understanding…',
  orManual: 'Or enter manually', signOut: 'Sign out', language: 'Language',
  confirm: 'Confirm', edit: 'Edit', cancel: 'Cancel', recordAnother: 'Record another', retry: 'Retry',
  takeStock: 'Take stock', placedInRoom: 'Placed in room', returnToStore: 'Return to store', stockReceived: 'Stock received', sendToHotel: 'Send to hotel',
  fromMyStock: 'My carried stock', fromStore: 'Hotel store', source: 'Taken from', room: 'Room', item: 'Item', qty: 'Qty',
  pleaseCheck: 'Please check this', chooseSource: 'Choose where these came from', saved: 'Recorded', reference: 'Reference',
  notSubmitted: 'Not submitted', micDenied: 'Microphone is blocked. Allow it in browser settings, or enter manually.',
  voiceUnavailable: "We couldn't understand that recording. Try again or enter it manually.",
  noStockWithYou: 'You are not carrying any stock.', incoming: 'Incoming', send: 'Send stock', confirmReceived: 'Confirm received',
  addItem: 'Add item', destination: 'To hotel', yes: 'Yes', change: 'Change', available: 'Available',
  examples: ['Placed two soaps in room 203', 'Took 10 combs from store'],
};
type Dict = typeof en;
const hi: Dict = {
  ...en,
  speak: 'बोलें', myStock: 'मेरा स्टॉक', transfers: 'ट्रांसफर', activity: 'गतिविधि',
  tapAndTell: 'टैप करें और बताएं आपने क्या लिया या रखा।', recording: 'रिकॉर्डिंग… रोकने के लिए टैप करें', understanding: 'समझ रहे हैं…',
  orManual: 'या हाथ से भरें', signOut: 'साइन आउट', language: 'भाषा', confirm: 'पुष्टि करें', edit: 'बदलें', cancel: 'रद्द करें',
  recordAnother: 'एक और दर्ज करें', retry: 'फिर से कोशिश', takeStock: 'स्टॉक लिया', placedInRoom: 'कमरे में रखा', returnToStore: 'स्टोर में वापस',
  stockReceived: 'स्टॉक आया', sendToHotel: 'होटल को भेजा', fromMyStock: 'मेरे पास का स्टॉक', fromStore: 'होटल स्टोर', source: 'कहाँ से',
  room: 'कमरा', item: 'सामान', qty: 'संख्या', pleaseCheck: 'कृपया जाँचें', chooseSource: 'चुनें सामान कहाँ से लिया', saved: 'दर्ज हो गया',
  reference: 'संदर्भ', notSubmitted: 'जमा नहीं हुआ', yes: 'हाँ', change: 'बदलें', available: 'उपलब्ध', incoming: 'आने वाला', send: 'स्टॉक भेजें',
  confirmReceived: 'मिलने की पुष्टि', addItem: 'सामान जोड़ें', destination: 'किस होटल को',
  examples: ['कमरा 203 में दो साबुन रखे', 'Room 203 mein 2 soap rakhe'],
};
const gu: Dict = {
  ...en,
  speak: 'બોલો', myStock: 'મારો સ્ટોક', transfers: 'ટ્રાન્સફર', activity: 'પ્રવૃત્તિ',
  tapAndTell: 'ટૅપ કરો અને કહો તમે શું લીધું કે મૂક્યું.', recording: 'રેકોર્ડિંગ… રોકવા ટૅપ કરો', understanding: 'સમજી રહ્યા છીએ…',
  orManual: 'અથવા જાતે ભરો', signOut: 'સાઇન આઉટ', language: 'ભાષા', confirm: 'પુષ્ટિ કરો', edit: 'બદલો', cancel: 'રદ કરો',
  recordAnother: 'બીજું નોંધો', retry: 'ફરી પ્રયાસ', takeStock: 'સ્ટોક લીધો', placedInRoom: 'રૂમમાં મૂક્યું', returnToStore: 'સ્ટોરમાં પાછું',
  stockReceived: 'સ્ટોક આવ્યો', sendToHotel: 'હોટેલને મોકલ્યું', fromMyStock: 'મારી પાસેનો સ્ટોક', fromStore: 'હોટેલ સ્ટોર', source: 'ક્યાંથી',
  room: 'રૂમ', item: 'વસ્તુ', qty: 'સંખ્યા', pleaseCheck: 'કૃપા કરી તપાસો', chooseSource: 'વસ્તુ ક્યાંથી લીધી તે પસંદ કરો', saved: 'નોંધાઈ ગયું',
  reference: 'સંદર્ભ', notSubmitted: 'મોકલાયું નથી', yes: 'હા', change: 'બદલો', available: 'ઉપલબ્ધ', incoming: 'આવનાર', send: 'સ્ટોક મોકલો',
  confirmReceived: 'મળ્યાની પુષ્ટિ', addItem: 'વસ્તુ ઉમેરો', destination: 'કઈ હોટેલને',
  examples: ['રૂમ ૨૦૩ માં બે સાબુ મૂક્યા', 'Room 203 mein 2 soap rakhe'],
};
export const DICTS: Record<Lang, Dict> = { en, hi, gu };
export const LANG_NAMES: Record<Lang, string> = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' };
export const LANG_CODES: Record<Lang, string> = { en: 'en-IN', hi: 'hi-IN', gu: 'gu-IN' };
