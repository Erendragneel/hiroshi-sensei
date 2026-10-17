export const GUIDED_NOTICE = 'Human-written scripted scenes, not AI/free chat. Only recognized choices advance.';

export const SCENES = [
 { id: 'cafe', label: 'At the café', title: 'A little coffee break', description: 'Order a drink.', goal: 'Choose a drink, temperature, size, and finish.', emoji: '☕', location: 'Hidamari Café', theme: 'cafe' },
 { id: 'walk', label: 'A gentle walk', title: 'The scenic way home', description: 'Walk and talk.', goal: 'Choose a place, season, and plan.', emoji: '🌿', location: 'The neighborhood park', theme: 'walk' },
 { id: 'home', label: 'Back at home', title: 'Tell me about your day', description: 'Relax together.', goal: 'Share your day, feelings, and activity.', emoji: '🏡', location: 'Hiroshi sensei’s cozy studio', theme: 'home' },
 { id: 'travel', label: 'Out exploring', title: 'A small adventure', description: 'Take a train trip.', goal: 'Ask for directions, a destination, and a ticket.', emoji: '🚃', location: 'A quiet station', theme: 'travel' },
];

const phrase = (reply, reading, translation) => ({ reply, reading, translation });
const option = (text, meaning) => ({ text, meaning });
const normalize = (value) => String(value ?? '').normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").trim();
const has = (text, japanese, english) => japanese.test(text) || english.test(text);
const negative = (text) => /\b(?:don't|do not|not|hate|dislike|never|can't|cannot)\b|いらない|要らない|嫌い|じゃない|ではない|ほしくない|欲しくない/.test(text);
const asksMeaning = (text) => /^(?:what (?:is|does)|why|how (?:do|does)|explain)\b|どういう意味|意味は|何ですか|なんですか/.test(text);
const choice = (text, choices, allowNegative = false) => {
 if ((!allowNegative && negative(text)) || asksMeaning(text)) return null;
 const found = choices.filter(([japanese, english]) => has(text, japanese, english));
 return found.length === 1 ? found[0][2] : null;
};
const entry = (japanese, english, answer) => [japanese, english, answer];
const follow = (line, prompt) => phrase(line[0] + prompt.reply, line[1] + ' ' + prompt.reading, line[2] + ' ' + prompt.translation);
const result = (line, suggestions, stage, complete = false, matched = false, correction = '') => ({ ...line, correction, suggestions, stage, complete, matched });
const asLanguage = (value, language) => language === 'en'
 ? { ...value, reply: value.translation, reading: '', translation: '', suggestions: value.suggestions.map(({ meaning }) => ({ text: meaning, meaning })) }
 : value;

const CAFE_OPTIONS = [
 [option('コーヒーをください。', 'Coffee, please.'), option('お茶をください。', 'Tea, please.'), option('ジュースをください。', 'Juice, please.')],
 [option('温かいのをお願いします。', 'Hot, please.'), option('冷たいのをお願いします。', 'Iced, please.'), option('どちらでもいいです。', 'Either is fine.')],
 [option('Sサイズをお願いします。', 'Small, please.'), option('Mサイズをお願いします。', 'Medium, please.'), option('Lサイズをお願いします。', 'Large, please.')],
 [option('以上です。', 'That’s all.'), option('ほかにはありません。', 'Nothing else.'), option('ありがとう。', 'Thank you.')],
];
const WALK_OPTIONS = [
 [option('公園に行きたいです。', 'I’d like to go to the park.'), option('川のそばを歩きたいです。', 'I’d like to walk by the river.'), option('庭を見たいです。', 'I’d like to see the garden.')],
 [option('春が好きです。', 'I like spring.'), option('夏が好きです。', 'I like summer.'), option('秋が好きです。', 'I like autumn.')],
 [option('写真を撮りたいです。', 'I’d like to take photos.'), option('少し休みたいです。', 'I’d like to rest a little.'), option('もっと歩きたいです。', 'I’d like to walk some more.')],
 [option('うん、行こう。', 'Yes, let’s go.'), option('楽しみです。', 'I’m looking forward to it.'), option('ありがとう。', 'Thank you.')],
];
const HOME_OPTIONS = [
 [option('いい一日でした。', 'It was a good day.'), option('忙しい一日でした。', 'It was a busy day.'), option('大変な一日でした。', 'It was a difficult day.')],
 [option('元気です。', 'I feel good.'), option('少し疲れています。', 'I’m a little tired.'), option('おなかがすいています。', 'I’m hungry.')],
 [option('音楽を聞きたいです。', 'I’d like to listen to music.'), option('お茶を飲みたいです。', 'I’d like to have some tea.'), option('ゆっくり休みたいです。', 'I’d like to rest.')],
 [option('うん、そうしよう。', 'Yes, let’s do that.'), option('ありがとう。', 'Thank you.'), option('またあとで。', 'See you later.')],
];
const TRAVEL_OPTIONS = [
 [option('駅はどこですか。', 'Where is the station?'), option('バス停はどこですか。', 'Where is the bus stop?'), option('空港はどこですか。', 'Where is the airport?')],
 [option('京都に行きたいです。', 'I’d like to go to Kyoto.'), option('東京に行きたいです。', 'I’d like to go to Tokyo.'), option('大阪に行きたいです。', 'I’d like to go to Osaka.')],
 [option('片道を一枚ください。', 'One one-way ticket, please.'), option('往復を一枚ください。', 'One return ticket, please.'), option('片道を二枚ください。', 'Two one-way tickets, please.')],
 [option('ありがとう。', 'Thank you.'), option('助かりました。', 'That was helpful.'), option('行ってきます。', 'I’m off!')],
];

const cafe = {
 options: CAFE_OPTIONS,
 opening: phrase('いらっしゃいませ。何を飲みますか？', 'Irasshaimase. Nani o nomimasu ka?', 'Welcome! What would you like to drink?'),
 fallback: [
  null,
  phrase('温かいのと冷たいの、どちらにしますか？', 'Atatakai no to tsumetai no, dochira ni shimasu ka?', 'Would you like it hot or iced?'),
  phrase('サイズはS、M、L、どれにしますか？', 'Saizu wa esu, emu, eru, dore ni shimasu ka?', 'Would you like a small, medium, or large?'),
  phrase('ほかにご注文はありますか？', 'Hoka ni gochūmon wa arimasu ka?', 'Would you like anything else?'),
 ],
 respond(stage, text) {
  if (stage === 0) {
   const drink = choice(text, [
    entry(/コーヒー|珈琲|コヒー/, /\b(?:coffee|kohi|koohii)\b/, ['コーヒー', 'Kōhī', 'Coffee']),
    entry(/お茶|紅茶|緑茶|抹茶|ティー/, /\b(?:tea|ocha|matcha)\b/, ['お茶', 'Ocha', 'Tea']),
    entry(/ジュース/, /\bjuice\b/, ['ジュース', 'Jūsu', 'Juice']),
   ]);
   if (!drink) return null;
   return { line: follow([`${drink[0]}ですね。`, `${drink[1]} desu ne.`, `${drink[2]} it is.`], cafe.fallback[1]), correction: /コヒー/.test(text) ? 'Write コーヒー (kōhī), with a long vowel.' : '' };
  }
  if (stage === 1) {
   const temperature = choice(text, [
    entry(/温か|あたたか|暖か|熱い|ホット/, /\b(?:hot|warm|atatakai|hotto)\b/, ['温かいの', 'Atatakai no', 'A hot drink']),
    entry(/冷た|つめた|アイス/, /\b(?:iced|ice|cold|tsumetai)\b/, ['冷たいの', 'Tsumetai no', 'An iced drink']),
    entry(/どちらでも|どっちでも|おまかせ|お任せ/, /\b(?:either|any|surprise me)\b/, ['では、温かいの', 'Dewa, atatakai no', 'A hot drink']),
   ]);
   if (!temperature) return null;
   return { line: follow([`${temperature[0]}ですね。`, `${temperature[1]} desu ne.`, `${temperature[2]} it is.`], cafe.fallback[2]) };
  }
  if (stage === 2) {
   const size = choice(text, [
    entry(/sサイズ|小さい|スモール/, /\bsmall\b|^s$|\bs size\b|\bsize s\b/, ['S', 'Esu', 'Small']),
    entry(/mサイズ|普通|ふつう|ミディアム/, /\b(?:medium|regular)\b|^m$|\bm size\b|\bsize m\b/, ['M', 'Emu', 'Medium']),
    entry(/lサイズ|大きい|ラージ/, /\b(?:large|big)\b|^l$|\bl size\b|\bsize l\b/, ['L', 'Eru', 'Large']),
   ]);
   if (!size) return null;
   return { line: follow([`${size[0]}サイズですね。`, `${size[1]} saizu desu ne.`, `${size[2]}, of course.`], cafe.fallback[3]) };
  }
  if (has(text, /以上|いじょう|ありません|ないです|いいえ|ありがとう|これで/, /\b(?:that's all|that is all|nothing else|no thanks|thanks|thank you)\b|^(?:no|done|finished)[.!]?$/)) {
   return { line: phrase('ありがとう。どうぞ、ごゆっくり。', 'Arigatō. Dōzo, goyukkuri.', 'Thank you. Here’s your drink. Enjoy!') };
  }
  return null;
 },
};

const walk = {
 options: WALK_OPTIONS,
 opening: phrase('少し散歩しよう。公園、川、庭、どこに行きたい？', 'Sukoshi sanpo shiyō. Kōen, kawa, niwa, doko ni ikitai?', 'Let’s go for a little walk. Would you like to visit the park, river, or garden?'),
 fallback: [
  null,
  phrase('好きな季節はいつ？', 'Suki na kisetsu wa itsu?', 'What’s your favorite season?'),
  phrase('写真を撮る、少し休む、もっと歩く。どれにしようか？', 'Shashin o toru, sukoshi yasumu, motto aruku. Dore ni shiyō ka?', 'Shall we take photos, rest, or keep walking?'),
  phrase('準備はいい？', 'Junbi wa ii?', 'Ready to go?'),
 ],
 respond(stage, text) {
  if (stage === 0) {
   const place = choice(text, [
    entry(/公園|こうえん/, /\b(?:park|koen|kouen)\b/, ['公園は気持ちがいいね。', 'Kōen wa kimochi ga ii ne.', 'The park sounds lovely.']),
    entry(/川|かわ/, /\b(?:river|kawa)\b/, ['川のそばは静かでいいね。', 'Kawa no soba wa shizuka de ii ne.', 'It’s nice and quiet by the river.']),
    entry(/庭|にわ/, /\b(?:garden|niwa)\b/, ['庭の花を見るのもいいね。', 'Niwa no hana o miru no mo ii ne.', 'Looking at the garden flowers sounds nice.']),
   ]);
   if (!place) return null;
   return { line: follow(place, walk.fallback[1]) };
  }
  if (stage === 1) {
   const season = choice(text, [
    entry(/春|はる/, /\b(?:spring|haru)\b/, ['春は花がきれいだね。', 'Haru wa hana ga kirei da ne.', 'The flowers are beautiful in spring.']),
    entry(/夏|なつ/, /\b(?:summer|natsu)\b/, ['夏は緑がきれいだね。', 'Natsu wa midori ga kirei da ne.', 'The greenery is beautiful in summer.']),
    entry(/秋|あき/, /\b(?:autumn|fall|aki)\b/, ['秋は涼しくて歩きやすいね。', 'Aki wa suzushikute arukiyasui ne.', 'Autumn is cool and lovely for walking.']),
    entry(/冬|ふゆ/, /\b(?:winter|fuyu)\b/, ['冬の静かな空気もいいね。', 'Fuyu no shizuka na kūki mo ii ne.', 'The quiet air in winter is lovely too.']),
   ]);
   if (!season) return null;
   return { line: follow(season, walk.fallback[2]) };
  }
  if (stage === 2) {
   const plan = choice(text, [
    entry(/写真|しゃしん|撮り|撮る/, /\b(?:photos?|pictures?|camera|shashin)\b/, ['景色の写真を撮ろう。', 'Keshiki no shashin o torō.', 'Let’s take some photos of the scenery.']),
    entry(/休み|休む|休憩|やすみ|やすむ|ベンチ/, /\b(?:rest|break|sit|bench)\b/, ['ベンチで少し休もう。', 'Benchi de sukoshi yasumō.', 'Let’s rest on a bench for a while.']),
    entry(/歩き|歩く|あるき|あるく|散歩/, /\b(?:walk|walking|stroll|keep going)\b/, ['もう少し歩こう。', 'Mō sukoshi arukō.', 'Let’s walk a little farther.']),
   ]);
   if (!plan) return null;
   return { line: follow(plan, walk.fallback[3]) };
  }
  if (!negative(text) && has(text, /行こう|いこう|楽しみ|たのしみ|うん|はい|ありがとう|いいよ|大丈夫/, /\b(?:yes|yeah|ready|let's go|looking forward|thanks|thank you|okay|ok)\b/)) {
   return { line: phrase('じゃあ、行こう。のんびり歩こうね。', 'Jā, ikō. Nonbiri arukō ne.', 'Let’s go. We can take our time.') };
  }
  return null;
 },
};

const home = {
 options: HOME_OPTIONS,
 opening: phrase('おかえり。今日はどんな一日だった？', 'Okaeri. Kyō wa donna ichinichi datta?', 'Welcome home. How was your day?'),
 fallback: [
  null,
  phrase('今はどんな気分？', 'Ima wa donna kibun?', 'How are you feeling now?'),
  phrase('音楽、お茶、休憩。どれがいい？', 'Ongaku, ocha, kyūkei. Dore ga ii?', 'Would you like music, tea, or some rest?'),
  phrase('それでいい？', 'Sore de ii?', 'Does that sound good?'),
 ],
 respond(stage, text) {
  if (stage === 0) {
   const day = choice(text, [
    entry(/いい一日|良い一日|よかった|楽しか|たのしか|最高/, /\b(?:good|great|nice|wonderful|fun|lovely)\b/, ['いい一日だったんだね。', 'Ii ichinichi dattan da ne.', 'Sounds like it was a good day.']),
    entry(/忙し|いそがし/, /\b(?:busy|hectic)\b/, ['忙しかったんだね。おつかれさま。', 'Isogashikattan da ne. Otsukaresama.', 'A busy day, then. You’ve earned a breather.']),
    entry(/大変|たいへん|つら|悪い|わるい/, /\b(?:hard|difficult|rough|bad|tough|awful)\b/, ['大変だったね。', 'Taihen datta ne.', 'That sounds tough.']),
   ]);
   if (!day) return null;
   return { line: follow(day, home.fallback[1]) };
  }
  if (stage === 1) {
   const feeling = choice(text, [
    entry(/元気|げんき|うれしい|嬉しい/, /\b(?:good|well|happy|great|energized|genki)\b/, ['元気でよかった。', 'Genki de yokatta.', 'I’m glad you’re feeling good.']),
    entry(/疲れ|つかれ|眠い|ねむい/, /\b(?:tired|sleepy|exhausted|tsukareta)\b/, ['少し疲れているんだね。', 'Sukoshi tsukarete irun da ne.', 'You’re feeling a little tired.']),
    entry(/おなか|お腹|空腹/, /\b(?:hungry|starving)\b/, ['おなかがすいているんだね。', 'Onaka ga suite irun da ne.', 'You’re feeling hungry.']),
   ]);
   if (!feeling) return null;
   return { line: follow(feeling, home.fallback[2]) };
  }
  if (stage === 2) {
   const activity = choice(text, [
    entry(/音楽|おんがく|聞き|聴き|聞く|聴く/, /\b(?:music|listen|listening|ongaku)\b/, ['静かな音楽をかけよう。', 'Shizuka na ongaku o kakeyō.', 'Let’s put on some quiet music.']),
    entry(/お茶|紅茶|緑茶|ティー/, /\b(?:tea|ocha)\b/, ['温かいお茶を入れよう。', 'Atatakai ocha o ireyō.', 'Let’s make some warm tea.']),
    entry(/休み|休む|休憩|やすみ|やすむ|寝|ゆっくり/, /\b(?:rest|break|sleep|relax|nap)\b/, ['ゆっくり休もう。', 'Yukkuri yasumō.', 'Let’s take it easy and rest.']),
   ]);
   if (!activity) return null;
   return { line: follow(activity, home.fallback[3]) };
  }
  if (!negative(text) && has(text, /そうしよう|うん|はい|いいね|いいよ|ありがとう|またあとで|また後で/, /\b(?:yes|yeah|sure|let's|sounds good|thanks|thank you|see you|later|okay|ok)\b/)) {
   return { line: phrase('うん。また話そうね。おつかれさま。', 'Un. Mata hanasō ne. Otsukaresama.', 'Of course. Talk again soon. Take care.') };
  }
  return null;
 },
};

const travel = {
 options: TRAVEL_OPTIONS,
 opening: phrase('こんにちは。道をお探しですか？どこに行きたいですか？', 'Konnichiwa. Michi o osagashi desu ka? Doko ni ikitai desu ka?', 'Hello. Are you looking for directions? Would you like the station, bus stop, or airport?'),
 fallback: [
  null,
  phrase('行き先は京都、東京、大阪、どちらですか？', 'Ikisaki wa Kyōto, Tōkyō, Ōsaka, dochira desu ka?', 'Would you like to go to Kyoto, Tokyo, or Osaka?'),
  phrase('切符は片道ですか、往復ですか？何枚ですか？', 'Kippu wa katamichi desu ka, ōfuku desu ka? Nanmai desu ka?', 'One-way or return? How many tickets?'),
  phrase('切符をどうぞ。よい旅を！', 'Kippu o dōzo. Yoi tabi o!', 'Here’s your ticket. Have a lovely trip!'),
 ],
 respond(stage, text) {
  if (stage === 0) {
   const place = choice(text, [
    entry(/駅|えき/, /\b(?:station|eki)\b/, ['駅は、この道をまっすぐです。', 'Eki wa, kono michi o massugu desu.', 'The station is straight down this road.']),
    entry(/バス停|ばすてい/, /\b(?:bus stop|busstop|basutei)\b/, ['バス停は、駅の前です。', 'Basutei wa, eki no mae desu.', 'The bus stop is in front of the station.']),
    entry(/空港|くうこう/, /\b(?:airport|kuko|kuukou)\b/, ['空港へは、駅から電車で行けます。', 'Kūkō e wa, eki kara densha de ikemasu.', 'You can take a train to the airport from the station.']),
   ]);
   if (!place) return null;
   return { line: phrase(`${place[0]}次は切符の練習です。京都、東京、大阪、どこに行きますか？`, `${place[1]} Tsugi wa kippu no renshū desu. Kyōto, Tōkyō, Ōsaka, doko ni ikimasu ka?`, `${place[2]} Now let’s practice tickets. Kyoto, Tokyo, or Osaka?`) };
  }
  if (stage === 1) {
   const destination = choice(text, [
    entry(/京都|きょうと/, /\bkyoto\b/, ['京都', 'Kyōto', 'Kyoto']),
    entry(/東京|とうきょう/, /\btokyo\b/, ['東京', 'Tōkyō', 'Tokyo']),
    entry(/大阪|おおさか/, /\bosaka\b/, ['大阪', 'Ōsaka', 'Osaka']),
   ]);
   if (!destination) return null;
   return { line: follow([`${destination[0]}ですね。`, `${destination[1]} desu ne.`, `${destination[2]}, of course.`], travel.fallback[2]) };
  }
  if (stage === 2) {
   const ticket = choice(text, [
    entry(/往復|おうふく/, /\b(?:return|round trip|round-trip|ofuku|oufuku)\b/, ['往復', 'Ōfuku', 'return']),
    entry(/片道|かたみち/, /\b(?:one way|one-way|single|katamichi)\b/, ['片道', 'Katamichi', 'one-way']),
   ]);
   const two = /二枚|2枚|にまい|\b(?:two|2)\b/.test(text);
   const tooMany = /三枚|四枚|五枚|[3-9]枚|\b(?:three|four|five|[3-9])\b/.test(text);
   if (!ticket || tooMany) return null;
   const count = two ? ['二枚', 'nimai', 'two'] : ['一枚', 'ichimai', 'one'];
   return { line: phrase(`${ticket[0]}の切符を${count[0]}ですね。こちらをどうぞ。よい旅を！`, `${ticket[1]} no kippu o ${count[1]} desu ne. Kochira o dōzo. Yoi tabi o!`, `${count[2][0].toUpperCase() + count[2].slice(1)} ${ticket[2]} ticket${two ? 's' : ''}. Here you are. Have a lovely trip!`) };
  }
  if (has(text, /ありがとう|助かり|たすかり|行ってきます|いってきます|さようなら/, /\b(?:thanks|thank you|helpful|helped|i'm off|i am off|goodbye|bye)\b/)) {
   return { line: phrase('どういたしまして。よい旅を！', 'Dō itashimashite. Yoi tabi o!', 'You’re welcome. Have a lovely trip!') };
  }
  return null;
 },
};

const scenes = { cafe, walk, home, travel };
const sceneFor = (id) => Object.hasOwn(scenes, id) ? scenes[id] : cafe;

export function guidedStart(sceneId, language = 'ja') {
 const scene = sceneFor(sceneId);
 return asLanguage(result(scene.opening, scene.options[0], 0), language);
}

export function guidedReply(sceneId, stage, userText, language = 'ja') {
 const scene = sceneFor(sceneId);
 const current = Number.isFinite(Number(stage)) ? Math.max(0, Math.min(4, Math.floor(Number(stage)))) : 0;
 if (current === 4) {
  return asLanguage(result(
   phrase('おしまい。もう一度？別の場面？', 'Oshimai. Mō ichido? Betsu no bamen?', 'Scene complete. Restart, change scene, or rest.'),
   [option('もう一度練習する', 'Start again'), option('別の場面を選ぶ', 'Change scene'), option('少し休む', 'Take a break')],
   4, true, false,
  ), language);
 }
 const text = normalize(userText);
 const answer = text ? scene.respond(current, text) : null;
 if (!answer) return asLanguage(result(scene.fallback[current] || scene.opening, scene.options[current], current), language);
 const next = current + 1;
 const suggestions = next === 4
  ? [option('もう一度練習する', 'Start again'), option('別の場面を選ぶ', 'Change scene'), option('少し休む', 'Take a break')]
  : scene.options[next];
 return asLanguage(result(answer.line, suggestions, next, next === 4, true, answer.correction || ''), language);
}
