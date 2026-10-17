// A small authored course. Assessment is exact-answer practice, never an AI grade.
const write = (id, prompt, answers, sample, explanation, extra = {}) => ({
  id, type: 'write', prompt, answers, sample, explanation, ...extra,
});
const choice = (id, prompt, options, answer, explanation) => ({
  id, type: 'choice', prompt, options, answers: [answer], sample: answer, explanation,
});

export const LESSONS = [
  {
    id: 'introductions', title: 'Meet someone new', subtitle: 'Greetings & introductions', minutes: 8,
    objective: 'Introduce yourself and say that you are studying Japanese.',
    explanation: [
      'はじめまして (Hajimemashite) means “Nice to meet you” when you meet someone for the first time.',
      'Use 私は … です (Watashi wa … desu) to introduce yourself. The topic particle は is written ha but pronounced wa. In conversation, you can leave out 私は when the topic is clear.',
      '日本語を勉強しています (Nihongo o benkyō shite imasu) means “I am studying Japanese.” The particle を is pronounced o. よろしくお願いします is a polite phrase used at the end of an introduction.',
      'For these exercises, copy the forms taught here. You can answer in Japanese or use the example’s romanization. Capitalization, spaces, and ordinary punctuation do not affect the check.',
    ],
    examples: [
      { target: 'はじめまして。', reading: 'Hajimemashite.', meaning: 'Nice to meet you.' },
      { target: '私はケンです。', reading: 'Watashi wa Ken desu.', meaning: 'I am Ken.' },
      { target: '日本語を勉強しています。', reading: 'Nihongo o benkyō shite imasu.', meaning: 'I am studying Japanese.' },
      { target: 'よろしくお願いします。', reading: 'Yoroshiku onegai shimasu.', meaning: 'Pleased to meet you. (At the end of an introduction.)' },
    ],
    practice: [
      choice('intro-p1', 'Which phrase is for meeting someone for the first time?', ['はじめまして。', 'おやすみなさい。', 'いただきます。'], 'はじめまして。', 'はじめまして is the first-meeting greeting. おやすみなさい is “Good night.”'),
      write('intro-p2', 'Introduce yourself as Ken: “I am Ken.” Use …です.', ['私はケンです', 'わたしはケンです', 'ケンです', '私はけんです', 'わたしはけんです', 'けんです', 'Watashi wa Ken desu', 'Ken desu'], '私はケンです。 / Watashi wa Ken desu.', 'Put the name before です. 私は is optional when you are introducing yourself.'),
      write('intro-p3', 'Say “I am studying Japanese.” Use 日本語を勉強しています.', ['日本語を勉強しています', 'にほんごをべんきょうしています', 'Nihongo o benkyō shite imasu', 'Nihongo o benkyou shite imasu'], '日本語を勉強しています。 / Nihongo o benkyō shite imasu.', '日本語 is Japanese; を marks what you study; 勉強しています means “am studying.”'),
    ],
    homework: [
      write('intro-h1', 'Write the first-meeting greeting “Nice to meet you.”', ['はじめまして', 'Hajimemashite'], 'はじめまして。 / Hajimemashite.', 'Use はじめまして when you first meet someone.'),
      write('intro-h2', 'Introduce yourself as Ken: “I am Ken.” Use …です.', ['私はケンです', 'わたしはケンです', 'ケンです', '私はけんです', 'わたしはけんです', 'けんです', 'Watashi wa Ken desu', 'Ken desu'], '私はケンです。 / Watashi wa Ken desu.', 'A name followed by です is a polite introduction.'),
      choice('intro-h3', 'How is the topic particle は pronounced in 私はケンです?', ['wa', 'ha', 'wo'], 'wa', 'The particle は is pronounced wa. The same character is ha in other words.'),
      write('intro-h4', 'Say “I am studying Japanese.” Use the sentence from this lesson.', ['日本語を勉強しています', 'にほんごをべんきょうしています', 'Nihongo o benkyō shite imasu', 'Nihongo o benkyou shite imasu'], '日本語を勉強しています。 / Nihongo o benkyō shite imasu.', 'Keep を after 日本語 and use 勉強しています.'),
    ],
  },
  {
    id: 'cafe-requests', title: 'Order at a café', subtitle: 'Polite requests', minutes: 10,
    objective: 'Politely ask for a small coffee, water, or the bill.',
    explanation: [
      'Use [item] をください ([item] o kudasai) to ask politely for an item. コーヒーをください means “Coffee, please.”',
      '小さい (chiisai) means “small” and comes before the item: 小さいコーヒーをください. Many cafés use size labels such as S instead; here we are practicing the adjective.',
      'すみません (Sumimasen) gets someone’s attention politely. お会計をお願いします (Okaikei o onegai shimasu) means “The bill, please.”',
      'The long vowels in コーヒー are shown as kōhī in romanization. The checker also accepts koohii. These exercises ask for the exact request taught, so extra sentences are not included in the check.',
    ],
    examples: [
      { target: 'コーヒーをください。', reading: 'Kōhī o kudasai.', meaning: 'Coffee, please.' },
      { target: '小さいコーヒーをください。', reading: 'Chiisai kōhī o kudasai.', meaning: 'A small coffee, please.' },
      { target: '水をください。', reading: 'Mizu o kudasai.', meaning: 'Water, please.' },
      { target: 'お会計をお願いします。', reading: 'Okaikei o onegai shimasu.', meaning: 'The bill, please.' },
    ],
    practice: [
      choice('cafe-p1', 'Which sentence politely asks for coffee?', ['コーヒーをください。', 'コーヒーが好きです。', 'コーヒーはありません。'], 'コーヒーをください。', 'をください asks for an item. が好きです says that you like it.'),
      write('cafe-p2', 'Say “Water, please.” Use 水をください.', ['水をください', 'みずをください', 'Mizu o kudasai'], '水をください。 / Mizu o kudasai.', '水 (mizu) means water. Follow it with をください.'),
      write('cafe-p3', 'Say “A small coffee, please.” Use 小さい + コーヒー + をください.', ['小さいコーヒーをください', 'ちいさいコーヒーをください', 'Chiisai kōhī o kudasai', 'Chiisai koohii o kudasai'], '小さいコーヒーをください。 / Chiisai kōhī o kudasai.', '小さい goes before コーヒー. Keep the request をください.'),
    ],
    homework: [
      write('cafe-h1', 'Write “A small coffee, please.” Use 小さい…をください.', ['小さいコーヒーをください', 'ちいさいコーヒーをください', 'Chiisai kōhī o kudasai', 'Chiisai koohii o kudasai'], '小さいコーヒーをください。 / Chiisai kōhī o kudasai.', 'This task checks both the small size and a polite request for coffee.'),
      write('cafe-h2', 'Write “Water, please.” Use …をください.', ['水をください', 'みずをください', 'Mizu o kudasai'], '水をください。 / Mizu o kudasai.', 'Use 水 for water and をください for the request.'),
      choice('cafe-h3', 'Which word means “small”?', ['小さい', '大きい', '熱い'], '小さい', '小さい means small; 大きい means big; 熱い means hot.'),
      write('cafe-h4', 'Ask for “The bill, please.” Use お会計をお願いします.', ['お会計をお願いします', 'おかいけいをおねがいします', 'Okaikei o onegai shimasu'], 'お会計をお願いします。 / Okaikei o onegai shimasu.', 'お会計 means the bill or checkout. お願いします makes this a polite request.'),
    ],
  },
  {
    id: 'likes-dislikes', title: 'Talk about what you like', subtitle: 'Preferences & gentle negatives', minutes: 9,
    objective: 'Say that you like music or Japanese, and that you do not like coffee very much.',
    explanation: [
      'Use [thing] が好きです ([thing] ga suki desu) for “I like [thing].” 好き describes a preference; use が for the thing you like.',
      '音楽 (ongaku) is music. 日本語 (nihongo) is the Japanese language. と (to) joins nouns: 音楽と日本語が好きです means “I like music and Japanese.”',
      'あまり…好きではありません (amari … suki dewa arimasen) means “do not like … very much.” The negative ending matters. あまりコーヒーが好きではありません is a gentle way to state this preference.',
      'This lesson uses the polite negative ではありません. The contracted form じゃありません is also accepted for the negative sentence.',
    ],
    examples: [
      { target: '音楽が好きです。', reading: 'Ongaku ga suki desu.', meaning: 'I like music.' },
      { target: '日本語が好きです。', reading: 'Nihongo ga suki desu.', meaning: 'I like Japanese.' },
      { target: '音楽と日本語が好きです。', reading: 'Ongaku to nihongo ga suki desu.', meaning: 'I like music and Japanese.' },
      { target: 'あまりコーヒーが好きではありません。', reading: 'Amari kōhī ga suki dewa arimasen.', meaning: 'I do not like coffee very much.' },
    ],
    practice: [
      choice('likes-p1', 'Which particle marks the thing you like in 音楽＿好きです?', ['が', 'を', 'で'], 'が', 'Use が with 好きです: 音楽が好きです.'),
      write('likes-p2', 'Say “I like music.” Use 音楽が好きです.', ['音楽が好きです', 'おんがくがすきです', 'Ongaku ga suki desu'], '音楽が好きです。 / Ongaku ga suki desu.', '音楽 is music; が好きです expresses a preference.'),
      write('likes-p3', 'Say “I do not like coffee very much.” Start with あまり.', ['あまりコーヒーが好きではありません', 'あまりコーヒーがすきではありません', 'あまりコーヒーが好きじゃありません', 'あまりコーヒーがすきじゃありません', 'Amari kōhī ga suki dewa arimasen', 'Amari koohii ga suki dewa arimasen', 'Amari kōhī ga suki ja arimasen', 'Amari koohii ga suki ja arimasen'], 'あまりコーヒーが好きではありません。 / Amari kōhī ga suki dewa arimasen.', 'あまり needs a negative here. 好きです would change the meaning.'),
    ],
    homework: [
      write('likes-h1', 'Write “I like Japanese.” Use 日本語が好きです.', ['日本語が好きです', 'にほんごがすきです', 'Nihongo ga suki desu'], '日本語が好きです。 / Nihongo ga suki desu.', 'Use が before 好きです.'),
      choice('likes-h2', 'What does 音楽と日本語が好きです mean?', ['I like music and Japanese.', 'I dislike music and Japanese.', 'I study music in Japan.'], 'I like music and Japanese.', 'と joins music and Japanese; が好きです means “like.”'),
      write('likes-h3', 'Write “I like music and Japanese.” Put music first.', ['音楽と日本語が好きです', 'おんがくとにほんごがすきです', 'Ongaku to nihongo ga suki desu'], '音楽と日本語が好きです。 / Ongaku to nihongo ga suki desu.', 'Join the two things with と, then use が好きです.'),
      write('likes-h4', 'Write “I do not like coffee very much.” Start with あまり.', ['あまりコーヒーが好きではありません', 'あまりコーヒーがすきではありません', 'あまりコーヒーが好きじゃありません', 'あまりコーヒーがすきじゃありません', 'Amari kōhī ga suki dewa arimasen', 'Amari koohii ga suki dewa arimasen', 'Amari kōhī ga suki ja arimasen', 'Amari koohii ga suki ja arimasen'], 'あまりコーヒーが好きではありません。 / Amari kōhī ga suki dewa arimasen.', 'The negative ではありません (or じゃありません) keeps the intended meaning.'),
    ],
  },
  {
    id: 'daily-routine', title: 'Describe your day', subtitle: 'Time & daily routines', minutes: 10,
    objective: 'Say when you wake up and that you study Japanese every day.',
    explanation: [
      '七時 (shichiji) means seven o’clock. Use に (ni) after a clock time: 七時に起きます means “I wake up at seven.” ななじ (nanaji) is also used for seven o’clock; both readings are accepted here.',
      '毎日 (mainichi) means every day. Do not add に after 毎日 in these sentences. 毎日、日本語を勉強します means “I study Japanese every day.”',
      '起きます (okimasu) means wake up; 勉強します (benkyō shimasu) means study; 寝ます (nemasu) means go to bed. 十一時 (jūichiji) is eleven o’clock.',
      'The polite ending ます is used for regular habits here. A sentence about what you do every day uses します; しています can also describe an ongoing habit, but this exercise practices the form shown.',
    ],
    examples: [
      { target: '七時に起きます。', reading: 'Shichiji ni okimasu.', meaning: 'I wake up at seven.' },
      { target: '毎日、日本語を勉強します。', reading: 'Mainichi, nihongo o benkyō shimasu.', meaning: 'I study Japanese every day.' },
      { target: '十一時に寝ます。', reading: 'Jūichiji ni nemasu.', meaning: 'I go to bed at eleven.' },
    ],
    practice: [
      choice('routine-p1', 'Choose the particle: 七時＿起きます (I wake up at seven).', ['に', 'を', 'と'], 'に', 'に marks the clock time when an action happens.'),
      write('routine-p2', 'Say “I wake up at seven.” Use 七時に起きます.', ['七時に起きます', '七時におきます', '7時に起きます', '7時におきます', 'しちじにおきます', 'ななじにおきます', 'Shichiji ni okimasu', 'Nanaji ni okimasu'], '七時に起きます。 / Shichiji ni okimasu.', 'Place に after the time, followed by 起きます.'),
      write('routine-p3', 'Say “I study Japanese every day.” Start with 毎日 and use 勉強します.', ['毎日日本語を勉強します', 'まいにちにほんごをべんきょうします', 'Mainichi nihongo o benkyō shimasu', 'Mainichi nihongo o benkyou shimasu'], '毎日、日本語を勉強します。 / Mainichi, nihongo o benkyō shimasu.', '毎日 does not take に here. 日本語 is followed by を.'),
    ],
    homework: [
      write('routine-h1', 'Write “I wake up at seven.” Use the polite form 起きます.', ['七時に起きます', '七時におきます', '7時に起きます', '7時におきます', 'しちじにおきます', 'ななじにおきます', 'Shichiji ni okimasu', 'Nanaji ni okimasu'], '七時に起きます。 / Shichiji ni okimasu.', 'Use the time 七時 + に + 起きます.'),
      choice('routine-h2', 'Which expression means “every day”?', ['毎日', '昨日', '明日'], '毎日', '毎日 means every day. 昨日 means yesterday; 明日 means tomorrow.'),
      write('routine-h3', 'Write “I study Japanese every day.” Start with 毎日; use 勉強します.', ['毎日日本語を勉強します', 'まいにちにほんごをべんきょうします', 'Mainichi nihongo o benkyō shimasu', 'Mainichi nihongo o benkyou shimasu'], '毎日、日本語を勉強します。 / Mainichi, nihongo o benkyō shimasu.', 'Use 毎日 without に, and 日本語を勉強します.'),
      write('routine-h4', 'Write “I go to bed at eleven.” Use 十一時に寝ます.', ['十一時に寝ます', '十一時にねます', '11時に寝ます', '11時にねます', 'じゅういちじにねます', 'Jūichiji ni nemasu', 'Juuichiji ni nemasu'], '十一時に寝ます。 / Jūichiji ni nemasu.', '十一時 means eleven o’clock. に marks the time; 寝ます means go to bed.'),
    ],
  },
  {
    id: 'directions-travel', title: 'Find your way', subtitle: 'Directions & destinations', minutes: 10,
    objective: 'Ask where the station is and understand a simple direction.',
    explanation: [
      'Use [place] はどこですか ([place] wa doko desu ka) to ask where a place is. 駅はどこですか means “Where is the station?”',
      'まっすぐ行ってください (Massugu itte kudasai) means “Please go straight.” 右 (migi) is right and 左 (hidari) is left.',
      '右に曲がってください (Migi ni magatte kudasai) means “Please turn right.” 左に曲がってください means “Please turn left.”',
      '東京に行きます (Tōkyō ni ikimasu) means “I am going to Tokyo.” に marks the destination. The destination particle へ (e) is also accepted in this sentence.',
    ],
    examples: [
      { target: '駅はどこですか。', reading: 'Eki wa doko desu ka.', meaning: 'Where is the station?' },
      { target: 'まっすぐ行ってください。', reading: 'Massugu itte kudasai.', meaning: 'Please go straight.' },
      { target: '右に曲がってください。', reading: 'Migi ni magatte kudasai.', meaning: 'Please turn right.' },
      { target: '東京に行きます。', reading: 'Tōkyō ni ikimasu.', meaning: 'I am going to Tokyo.' },
    ],
    practice: [
      write('travel-p1', 'Ask “Where is the station?” Use 駅はどこですか.', ['駅はどこですか', 'えきはどこですか', 'Eki wa doko desu ka'], '駅はどこですか。 / Eki wa doko desu ka.', 'は marks the station as the topic; どこですか asks where it is.'),
      choice('travel-p2', 'What does 右 mean? Answer with the English direction.', ['right', 'left', 'straight'], 'right', '右 (migi) means right. 左 (hidari) means left.'),
      write('travel-p3', 'Say “Please go straight.” Use まっすぐ行ってください.', ['まっすぐ行ってください', 'まっすぐいってください', 'Massugu itte kudasai'], 'まっすぐ行ってください。 / Massugu itte kudasai.', 'まっすぐ means straight; 行ってください is a polite request to go.'),
    ],
    homework: [
      write('travel-h1', 'Write “Where is the station?”', ['駅はどこですか', 'えきはどこですか', 'Eki wa doko desu ka'], '駅はどこですか。 / Eki wa doko desu ka.', 'Use 駅 + は + どこですか.'),
      write('travel-h2', 'Write “Please turn right.” Use 右に曲がってください.', ['右に曲がってください', 'みぎにまがってください', 'Migi ni magatte kudasai'], '右に曲がってください。 / Migi ni magatte kudasai.', 'Use 右 for right, に, then 曲がってください.'),
      choice('travel-h3', 'What does 左に曲がってください mean?', ['Please turn left.', 'Please turn right.', 'Please go straight.'], 'Please turn left.', '左 (hidari) is left. 曲がってください asks someone to turn.'),
      write('travel-h4', 'Write “I am going to Tokyo.” Use 東京…行きます.', ['東京に行きます', 'とうきょうにいきます', '東京へ行きます', 'とうきょうへいきます', 'Tōkyō ni ikimasu', 'Toukyou ni ikimasu', 'Tokyo ni ikimasu', 'Tōkyō e ikimasu', 'Toukyou e ikimasu', 'Tokyo e ikimasu'], '東京に行きます。 / Tōkyō ni ikimasu.', 'に or へ can mark the destination. 行きます is the polite present/future form.'),
    ],
  },
  {
    id: 'past-weekend', title: 'Tell me about yesterday', subtitle: 'Past actions & a weekend story', minutes: 12,
    objective: 'Describe a trip, a meal, and study using the polite past tense.',
    explanation: [
      'For the verbs in this lesson, change the polite ending ます to ました to describe a completed past action: 行きます → 行きました (went), 食べます → 食べました (ate), 勉強します → 勉強しました (studied).',
      '昨日 (kinō) means yesterday. 昨日、東京に行きました means “I went to Tokyo yesterday.” 週末 (shūmatsu) means weekend.',
      'ラーメンを食べました (Rāmen o tabemashita) means “I ate ramen.” を marks what you ate. 日本語を勉強しました means “I studied Japanese.”',
      'A negative past sentence has a different meaning: 食べませんでした means “did not eat.” The exercises here ask for affirmative past actions.',
    ],
    examples: [
      { target: '昨日、東京に行きました。', reading: 'Kinō, Tōkyō ni ikimashita.', meaning: 'I went to Tokyo yesterday.' },
      { target: 'ラーメンを食べました。', reading: 'Rāmen o tabemashita.', meaning: 'I ate ramen.' },
      { target: '日本語を勉強しました。', reading: 'Nihongo o benkyō shimashita.', meaning: 'I studied Japanese.' },
      { target: '週末、ラーメンを食べました。', reading: 'Shūmatsu, rāmen o tabemashita.', meaning: 'I ate ramen over the weekend.' },
    ],
    practice: [
      choice('past-p1', 'Which form means “went” (polite past)?', ['行きました', '行きます', '行きませんでした'], '行きました', 'ました marks the affirmative polite past. ませんでした is negative past.'),
      write('past-p2', 'Say “I ate ramen.” Use ラーメンを食べました.', ['ラーメンを食べました', 'ラーメンをたべました', 'Rāmen o tabemashita', 'Raamen o tabemashita', 'Ramen o tabemashita'], 'ラーメンを食べました。 / Rāmen o tabemashita.', 'Use を after the food and 食べました for ate.'),
      write('past-p3', 'Say “I went to Tokyo yesterday.” Put 昨日 first.', ['昨日東京に行きました', 'きのうとうきょうにいきました', '昨日東京へ行きました', 'きのうとうきょうへいきました', 'Kinō Tōkyō ni ikimashita', 'Kinou Toukyou ni ikimashita', 'Kino Tokyo ni ikimashita', 'Kinō Tōkyō e ikimashita', 'Kinou Toukyou e ikimashita', 'Kino Tokyo e ikimashita'], '昨日、東京に行きました。 / Kinō, Tōkyō ni ikimashita.', '昨日 supplies yesterday; 東京に (or 東京へ) supplies the destination; 行きました is went.'),
    ],
    homework: [
      write('past-h1', 'Write “I studied Japanese.” Use 日本語を勉強しました.', ['日本語を勉強しました', 'にほんごをべんきょうしました', 'Nihongo o benkyō shimashita', 'Nihongo o benkyou shimashita'], '日本語を勉強しました。 / Nihongo o benkyō shimashita.', 'The past of 勉強します is 勉強しました.'),
      write('past-h2', 'Write “I went to Tokyo yesterday.” Put 昨日 first.', ['昨日東京に行きました', 'きのうとうきょうにいきました', '昨日東京へ行きました', 'きのうとうきょうへいきました', 'Kinō Tōkyō ni ikimashita', 'Kinou Toukyou ni ikimashita', 'Kino Tokyo ni ikimashita', 'Kinō Tōkyō e ikimashita', 'Kinou Toukyou e ikimashita', 'Kino Tokyo e ikimashita'], '昨日、東京に行きました。 / Kinō, Tōkyō ni ikimashita.', 'Keep the past tense 行きました and the time word 昨日.'),
      choice('past-h3', 'What does 食べませんでした mean?', ['did not eat', 'ate', 'will eat'], 'did not eat', 'ませんでした is the polite negative past, so it means “did not eat.”'),
      write('past-h4', 'Write “I ate ramen over the weekend.” Put 週末 first.', ['週末ラーメンを食べました', 'しゅうまつラーメンをたべました', 'Shūmatsu rāmen o tabemashita', 'Shuumatsu raamen o tabemashita', 'Shumatsu ramen o tabemashita'], '週末、ラーメンを食べました。 / Shūmatsu, rāmen o tabemashita.', '週末 is weekend; ラーメンを食べました says that you ate ramen.'),
    ],
  },
];

export const MAX_ATTEMPTS = 12;
const MAX_ANSWER_LENGTH = 1000;
const lessonById = (id) => LESSONS.find((lesson) => lesson.id === id);
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => {
  if (typeof value !== 'string') return '';
  // Keep saves bounded without turning a long, wrong answer into a correct prefix.
  return value.length <= MAX_ANSWER_LENGTH ? value : `${value.slice(0, 950)} [answer too long: maximum 1000 characters]`;
};
const iso = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
};
const nowTime = (value) => iso(value) || new Date().toISOString();

function normalizeAnswer(value, exercise) {
  let result = text(value).normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[\s。、，,.!！?？;；:："'“”‘’]/gu, '');
  // Only explicitly marked vocabulary tasks may treat the kana scripts alike.
  // Never convert kanji, guess a reading, remove negatives, or match substrings.
  if (exercise?.kanaEquivalent === true) {
    result = result.replace(/[ァ-ヶ]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0x60));
  }
  return result;
}

export function gradeExercise(exercise, answer) {
  const accepted = Array.isArray(exercise?.answers) ? exercise.answers.filter((item) => typeof item === 'string' && item.trim()) : [];
  const normalized = normalizeAnswer(answer, exercise);
  const correct = normalized !== '' && accepted.some((item) => normalized === normalizeAnswer(item, exercise));
  const expected = typeof exercise?.sample === 'string' ? exercise.sample : (accepted[0] || '');
  const explanation = typeof exercise?.explanation === 'string' ? exercise.explanation : '';
  return {
    correct,
    feedback: correct ? `Correct. ${explanation}`.trim() : `${normalized ? 'Try again.' : 'Please enter an answer.'} ${explanation} Expected: ${expected}`.trim(),
    expected,
  };
}

function cleanAnswers(raw, exercises) {
  const source = isRecord(raw) ? raw : {};
  return Object.fromEntries(exercises.map(({ id }) => [id, text(Object.hasOwn(source, id) ? source[id] : '')]));
}

function makeReport(exercises, answers, submittedAt) {
  const clean = cleanAnswers(answers, exercises);
  const results = exercises.map((exercise) => ({
    exerciseId: exercise.id, answer: clean[exercise.id], ...gradeExercise(exercise, clean[exercise.id]),
  }));
  const score = results.filter(({ correct }) => correct).length;
  return { submittedAt, score, total: exercises.length, passed: score === exercises.length, results };
}

function sanitizeReport(raw, exercises) {
  if (!isRecord(raw) || !iso(raw.submittedAt) || !Array.isArray(raw.results)) return null;
  const answers = {};
  for (const exercise of exercises) {
    const result = raw.results.find((item) => isRecord(item) && item.exerciseId === exercise.id);
    if (!result || typeof result.answer !== 'string') return null;
    answers[exercise.id] = result.answer;
  }
  return makeReport(exercises, answers, iso(raw.submittedAt));
}

const cleanAttempts = (raw, exercises) => (Array.isArray(raw) ? raw.slice(-MAX_ATTEMPTS) : [])
  .map((attempt) => sanitizeReport(attempt, exercises)).filter(Boolean);

export function createTeacherState() {
  return { version: 1, course: 'ja-beginner', activeLessonId: LESSONS[0].id, lessons: {}, assignments: [] };
}

export function createAssignment(lessonId, nowISO) {
  const lesson = lessonById(lessonId);
  if (!lesson) throw new RangeError('Unknown lesson.');
  const assignedAt = nowTime(nowISO);
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return {
    id: `homework-${lesson.id}-${token}`, lessonId: lesson.id,
    assignedAt, dueAt: new Date(Date.parse(assignedAt) + 24 * 60 * 60 * 1000).toISOString(),
    status: 'assigned', answers: cleanAnswers({}, lesson.homework), attempts: [],
    firstAttempt: null, submittedAt: null, firstScore: null, latestScore: null,
  };
}

export function sanitizeTeacherState(raw) {
  const state = createTeacherState();
  if (!isRecord(raw) || raw.course !== state.course || raw.version !== 1) return state;
  if (lessonById(raw.activeLessonId)) state.activeLessonId = raw.activeLessonId;
  if (isRecord(raw.lessons)) {
    for (const lesson of LESSONS) {
      if (!Object.hasOwn(raw.lessons, lesson.id) || !isRecord(raw.lessons[lesson.id])) continue;
      const saved = raw.lessons[lesson.id];
      const attempts = cleanAttempts(saved.attempts, lesson.practice);
      const storedCompletion = sanitizeReport(saved.completionAttempt, lesson.practice);
      const completionAttempt = storedCompletion?.passed ? storedCompletion : attempts.find(({ passed }) => passed) || null;
      state.lessons[lesson.id] = {
        answers: cleanAnswers(saved.answers, lesson.practice), attempts,
        completionAttempt, completedAt: completionAttempt?.submittedAt || null,
      };
    }
  }
  const usedIds = new Set();
  const usedLessons = new Set();
  // This course issues one assignment per lesson; avoid duplicates and oversized saves.
  for (const saved of (Array.isArray(raw.assignments) ? raw.assignments.slice(0, 60) : [])) {
    if (!isRecord(saved)) continue;
    const lesson = lessonById(saved.lessonId);
    const assignedAt = iso(saved.assignedAt);
    if (!lesson || !assignedAt || typeof saved.id !== 'string' || !/^[a-zA-Z0-9-]{1,160}$/.test(saved.id) || usedIds.has(saved.id) || usedLessons.has(lesson.id)) continue;
    const dueAt = iso(saved.dueAt);
    const attempts = cleanAttempts(saved.attempts, lesson.homework);
    const originalFirst = sanitizeReport(saved.firstAttempt, lesson.homework);
    const firstAttempt = originalFirst || attempts[0] || null;
    if (firstAttempt && attempts.length === 0) attempts.push(firstAttempt);
    const latest = attempts.at(-1) || null;
    state.assignments.push({
      id: saved.id, lessonId: lesson.id, assignedAt,
      dueAt: dueAt && Date.parse(dueAt) >= Date.parse(assignedAt) ? dueAt : new Date(Date.parse(assignedAt) + 86400000).toISOString(),
      status: latest ? 'submitted' : 'assigned', answers: cleanAnswers(saved.answers, lesson.homework),
      attempts, firstAttempt, submittedAt: latest?.submittedAt || null,
      firstScore: firstAttempt?.score ?? null, latestScore: latest?.score ?? null,
    });
    usedIds.add(saved.id);
    usedLessons.add(lesson.id);
  }
  return state;
}

export function recordLessonPractice(rawState, lessonId, answers, nowISO) {
  const lesson = lessonById(lessonId);
  if (!lesson) throw new RangeError('Unknown lesson.');
  const state = sanitizeTeacherState(rawState);
  const submittedAt = nowTime(nowISO);
  const report = makeReport(lesson.practice, answers, submittedAt);
  const previous = state.lessons[lesson.id];
  const completionAttempt = previous?.completionAttempt || (report.passed ? report : null);
  state.activeLessonId = lesson.id;
  state.lessons[lesson.id] = {
    answers: cleanAnswers(answers, lesson.practice),
    attempts: [...(previous?.attempts || []), report].slice(-MAX_ATTEMPTS),
    completionAttempt, completedAt: completionAttempt?.submittedAt || null,
  };
  if (report.passed && !state.assignments.some((assignment) => assignment.lessonId === lesson.id)) {
    state.assignments.push(createAssignment(lesson.id, submittedAt));
  }
  return { state, report };
}

export function submitAssignment(rawState, assignmentId, answers, nowISO) {
  const state = sanitizeTeacherState(rawState);
  const assignment = state.assignments.find(({ id }) => id === assignmentId);
  if (!assignment) throw new RangeError('Unknown assignment.');
  const lesson = lessonById(assignment.lessonId);
  const report = makeReport(lesson.homework, answers, nowTime(nowISO));
  assignment.answers = cleanAnswers(answers, lesson.homework);
  assignment.attempts = [...assignment.attempts, report].slice(-MAX_ATTEMPTS);
  assignment.firstAttempt ||= report;
  assignment.firstScore = assignment.firstAttempt.score;
  assignment.latestScore = report.score;
  assignment.submittedAt = report.submittedAt;
  assignment.status = 'submitted';
  return { state, report };
}
