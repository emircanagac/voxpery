export type EmojiOption = {
  emoji: string
  label: string
  keywords: string[]
}

export type EmojiCategory = {
  id: string
  label: string
  icon: string
  emojis: EmojiOption[]
}

export type GifOption = {
  id: string
  label: string
  url: string
  keywords: string[]
}

export type StickerOption = {
  id: string
  label: string
  imageUrl: string
  keywords: string[]
}

function dedupeEmojiOptions(options: EmojiOption[]): EmojiOption[] {
  const seen = new Set<string>()
  return options.filter((entry) => {
    if (seen.has(entry.emoji)) return false
    seen.add(entry.emoji)
    return true
  })
}

function item(emoji: string, label: string, keywords: string[] = []): EmojiOption {
  return { emoji, label, keywords }
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
    icon: '😀',
    emojis: [
      item('😀', 'grinning face', ['happy', 'smile']),
      item('😃', 'smiling face', ['happy', 'joy']),
      item('😄', 'grinning face with smiling eyes', ['happy', 'joy']),
      item('😁', 'beaming face', ['happy', 'cheese']),
      item('😆', 'laughing face', ['lol']),
      item('😂', 'face with tears of joy', ['lol', 'funny']),
      item('🤣', 'rolling on the floor laughing', ['rofl', 'lol']),
      item('😊', 'smiling face with blush', ['warm', 'happy']),
      item('🙂', 'slightly smiling face', ['nice']),
      item('😉', 'winking face', ['flirt', 'hint']),
      item('😍', 'smiling face with heart eyes', ['love']),
      item('😘', 'face blowing a kiss', ['love', 'kiss']),
      item('😎', 'smiling face with sunglasses', ['cool']),
      item('🥳', 'partying face', ['party', 'celebration']),
      item('🤩', 'star struck', ['wow']),
      item('🤔', 'thinking face', ['hmm']),
      item('🫠', 'melting face', ['awkward']),
      item('😅', 'grinning face with sweat', ['phew']),
      item('😴', 'sleeping face', ['tired']),
      item('😭', 'loudly crying face', ['sad']),
      item('😢', 'crying face', ['sad']),
      item('🥲', 'smiling face with tear', ['emotional']),
      item('😡', 'pouting face', ['angry', 'mad']),
      item('🤯', 'exploding head', ['mind blown']),
      item('😮', 'face with open mouth', ['wow', 'surprised']),
      item('😳', 'flushed face', ['embarrassed']),
      item('🥺', 'pleading face', ['please']),
      item('😇', 'smiling face with halo', ['angel']),
      item('🤗', 'hugging face', ['hug']),
      item('🫡', 'saluting face', ['respect']),
      item('😬', 'grimacing face', ['awkward']),
      item('🫣', 'face with peeking eye', ['peek']),
      item('🥹', 'face holding back tears', ['emotional', 'tears']),
      item('😵‍💫', 'face with spiral eyes', ['dizzy']),
      item('😤', 'face with steam from nose', ['determined', 'angry']),
      item('😈', 'smiling face with horns', ['mischief']),
      item('🤠', 'cowboy hat face', ['fun']),
      item('🤓', 'nerd face', ['smart']),
    ],
  },
  {
    id: 'people',
    label: 'People',
    icon: '👍',
    emojis: [
      item('👍', 'thumbs up', ['approve', 'yes']),
      item('👎', 'thumbs down', ['no']),
      item('👏', 'clapping hands', ['applause']),
      item('🙌', 'raising hands', ['celebration']),
      item('🙏', 'folded hands', ['thanks', 'pray']),
      item('🤝', 'handshake', ['deal']),
      item('💪', 'flexed biceps', ['strong']),
      item('👌', 'ok hand', ['okay']),
      item('✌️', 'victory hand', ['peace']),
      item('🤞', 'crossed fingers', ['luck']),
      item('🤟', 'love you gesture', ['ily']),
      item('👀', 'eyes', ['watching']),
      item('💅', 'nail polish', ['slay']),
      item('🫶', 'heart hands', ['love']),
      item('🧠', 'brain', ['smart']),
      item('🫂', 'people hugging', ['support']),
      item('🤦', 'face palm', ['oops']),
      item('🤷', 'shrug', ['idk']),
      item('🙃', 'upside down face', ['sarcasm']),
      item('🫵', 'pointing at you', ['you']),
      item('🖐️', 'hand with fingers splayed', ['hello']),
      item('👋', 'waving hand', ['hello', 'hi']),
      item('✍️', 'writing hand', ['write', 'note']),
      item('🤘', 'sign of the horns', ['rock']),
      item('🫰', 'hand with index finger and thumb crossed', ['money', 'heart']),
      item('🫴', 'palm up hand', ['offer']),
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    icon: '❤️',
    emojis: [
      item('❤️', 'red heart', ['love']),
      item('🩷', 'pink heart', ['love']),
      item('🧡', 'orange heart', ['love']),
      item('💛', 'yellow heart', ['love']),
      item('💚', 'green heart', ['love']),
      item('💙', 'blue heart', ['love']),
      item('🩵', 'light blue heart', ['love']),
      item('💜', 'purple heart', ['love']),
      item('🤍', 'white heart', ['love']),
      item('🖤', 'black heart', ['love']),
      item('🤎', 'brown heart', ['love']),
      item('💔', 'broken heart', ['sad']),
      item('❣️', 'heart exclamation', ['love']),
      item('💕', 'two hearts', ['love']),
      item('💖', 'sparkling heart', ['love']),
      item('💘', 'heart with arrow', ['crush']),
      item('💝', 'heart with ribbon', ['gift']),
      item('💓', 'beating heart', ['love']),
    ],
  },
  {
    id: 'nature',
    label: 'Nature',
    icon: '🌿',
    emojis: [
      item('🔥', 'fire', ['lit']),
      item('✨', 'sparkles', ['shine']),
      item('⭐', 'star', ['favorite']),
      item('🌟', 'glowing star', ['favorite']),
      item('☀️', 'sun', ['weather']),
      item('🌙', 'moon', ['night']),
      item('⚡', 'lightning', ['energy']),
      item('☁️', 'cloud', ['weather']),
      item('🌈', 'rainbow', ['color']),
      item('🌊', 'water wave', ['ocean']),
      item('❄️', 'snowflake', ['cold']),
      item('🌸', 'cherry blossom', ['flower']),
      item('🌹', 'rose', ['flower']),
      item('🌻', 'sunflower', ['flower']),
      item('🍀', 'four leaf clover', ['luck']),
      item('🌵', 'cactus', ['desert']),
      item('🌴', 'palm tree', ['vacation']),
      item('🪴', 'potted plant', ['plant']),
      item('🌧️', 'cloud with rain', ['weather', 'rain']),
      item('⛈️', 'cloud with lightning and rain', ['storm']),
      item('🌅', 'sunrise', ['morning']),
      item('🌌', 'milky way', ['night', 'space']),
    ],
  },
  {
    id: 'food',
    label: 'Food',
    icon: '🍕',
    emojis: [
      item('🍕', 'pizza', ['food']),
      item('🍔', 'burger', ['food']),
      item('🌮', 'taco', ['food']),
      item('🍜', 'ramen', ['food']),
      item('🍣', 'sushi', ['food']),
      item('🍟', 'fries', ['food']),
      item('🍿', 'popcorn', ['movie']),
      item('☕', 'coffee', ['drink']),
      item('🧋', 'bubble tea', ['drink']),
      item('🍵', 'tea', ['drink']),
      item('🥤', 'soft drink', ['drink']),
      item('🍰', 'cake', ['dessert']),
      item('🎂', 'birthday cake', ['party']),
      item('🍪', 'cookie', ['dessert']),
      item('🍎', 'apple', ['fruit']),
      item('🍓', 'strawberry', ['fruit']),
      item('🍇', 'grapes', ['fruit']),
      item('🍉', 'watermelon', ['fruit']),
      item('🍩', 'doughnut', ['dessert']),
      item('🍫', 'chocolate bar', ['dessert']),
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    icon: '🎉',
    emojis: [
      item('🎉', 'party popper', ['party']),
      item('🎊', 'confetti ball', ['party']),
      item('🎁', 'wrapped gift', ['present']),
      item('🎈', 'balloon', ['party']),
      item('🏆', 'trophy', ['win']),
      item('🥇', 'gold medal', ['winner']),
      item('🎮', 'video game', ['gaming']),
      item('🕹️', 'joystick', ['gaming']),
      item('🎵', 'musical note', ['music']),
      item('🎶', 'musical notes', ['music']),
      item('🎬', 'clapper board', ['movie']),
      item('⚽', 'soccer ball', ['sport']),
      item('🏀', 'basketball', ['sport']),
      item('🏐', 'volleyball', ['sport']),
      item('🏋️', 'person lifting weights', ['gym']),
      item('🎯', 'direct hit', ['target']),
      item('🧩', 'puzzle piece', ['puzzle']),
      item('🪩', 'mirror ball', ['party', 'dance']),
      item('🎤', 'microphone', ['sing', 'voice']),
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
    icon: '✈️',
    emojis: [
      item('🚗', 'car', ['travel']),
      item('🚕', 'taxi', ['travel']),
      item('✈️', 'airplane', ['travel']),
      item('🚀', 'rocket', ['launch']),
      item('🛸', 'ufo', ['space']),
      item('🗺️', 'map', ['travel']),
      item('🏠', 'house', ['home']),
      item('🏡', 'house with garden', ['home']),
      item('🏢', 'office building', ['work']),
      item('🏖️', 'beach', ['vacation']),
      item('🏕️', 'camping', ['outdoors']),
      item('🗽', 'statue of liberty', ['landmark']),
      item('🚢', 'ship', ['travel', 'boat']),
      item('🚆', 'train', ['travel']),
      item('⛽', 'fuel pump', ['car']),
      item('🛵', 'motor scooter', ['ride']),
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
    icon: '💡',
    emojis: [
      item('✅', 'check mark button', ['done', 'yes']),
      item('❌', 'cross mark', ['no', 'close']),
      item('⚠️', 'warning', ['alert']),
      item('❗', 'exclamation mark', ['alert']),
      item('❓', 'question mark', ['question']),
      item('💯', 'hundred points', ['perfect']),
      item('💥', 'collision', ['boom']),
      item('💤', 'zzz', ['sleep']),
      item('💡', 'light bulb', ['idea']),
      item('📌', 'pushpin', ['pin']),
      item('📣', 'megaphone', ['announce']),
      item('🔒', 'lock', ['secure']),
      item('🔑', 'key', ['unlock']),
      item('📷', 'camera', ['photo']),
      item('🎧', 'headphone', ['music']),
      item('📱', 'mobile phone', ['phone']),
      item('💻', 'laptop', ['computer']),
      item('🛠️', 'hammer and wrench', ['tools']),
      item('🧭', 'compass', ['direction']),
      item('🪄', 'magic wand', ['magic']),
      item('🧨', 'firecracker', ['boom']),
      item('📎', 'paperclip', ['attach']),
      item('🗂️', 'card index dividers', ['organize']),
      item('📝', 'memo', ['note', 'write']),
      item('📬', 'open mailbox with raised flag', ['mail', 'message']),
      item('🧪', 'test tube', ['science', 'experiment']),
      item('🪙', 'coin', ['money', 'cash']),
      item('🛎️', 'bellhop bell', ['notify', 'bell']),
      item('🧱', 'brick', ['build', 'block']),
      item('🧰', 'toolbox', ['tools', 'repair']),
      item('🗝️', 'old key', ['key', 'unlock']),
      item('🖇️', 'linked paperclips', ['attach', 'link']),
      item('🧲', 'magnet', ['pull', 'attract']),
    ],
  },
]

export const EMOJI_REACTION_OPTIONS: EmojiOption[] = [
  item('👍', 'thumbs up', ['approve']),
  item('❤️', 'red heart', ['love']),
  item('😂', 'face with tears of joy', ['lol']),
  item('🔥', 'fire', ['lit']),
  item('🎉', 'party popper', ['party']),
  item('👏', 'clapping hands', ['applause']),
  item('🙏', 'folded hands', ['thanks']),
  item('🥳', 'partying face', ['celebration']),
  item('😮', 'face with open mouth', ['wow']),
  item('😢', 'crying face', ['sad']),
  item('😭', 'loudly crying face', ['sad']),
  item('🤔', 'thinking face', ['hmm']),
  item('👀', 'eyes', ['watching']),
  item('💯', 'hundred points', ['perfect']),
  item('✅', 'check mark button', ['done']),
  item('❌', 'cross mark', ['no']),
]

export const GIF_OPTIONS: GifOption[] = [
  {
    id: 'celebration',
    label: 'Celebration',
    url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif',
    keywords: ['party', 'celebrate', 'yay'],
  },
  {
    id: 'thumbs-up',
    label: 'Thumbs up',
    url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif',
    keywords: ['ok', 'approve', 'yes'],
  },
  {
    id: 'laughing',
    label: 'Laughing',
    url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif',
    keywords: ['lol', 'funny', 'haha'],
  },
  {
    id: 'mind-blown',
    label: 'Mind blown',
    url: 'https://media.giphy.com/media/3o7TKtnuHOHHUjR38Y/giphy.gif',
    keywords: ['wow', 'shocked'],
  },
  {
    id: 'applause',
    label: 'Applause',
    url: 'https://media.giphy.com/media/l3q2XhfQ8oCkm1Ts4/giphy.gif',
    keywords: ['clap', 'nice', 'great'],
  },
  {
    id: 'facepalm',
    label: 'Facepalm',
    url: 'https://media.giphy.com/media/TJawtKM6OCKkvwCIqX/giphy.gif',
    keywords: ['oops', 'fail'],
  },
  {
    id: 'cat-typing',
    label: 'Cat typing',
    url: 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
    keywords: ['cat', 'typing', 'work'],
  },
  {
    id: 'thumbs-up-loop',
    label: 'Approved',
    url: 'https://media.giphy.com/media/ICOgUNjpvO0PC/giphy.gif',
    keywords: ['approve', 'ok', 'yes'],
  },
  {
    id: 'cheers',
    label: 'Cheers',
    url: 'https://media.giphy.com/media/3oEjHV0z8S7WM4MwnK/giphy.gif',
    keywords: ['cheers', 'drink', 'celebrate'],
  },
  {
    id: 'wave-hi',
    label: 'Wave',
    url: 'https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif',
    keywords: ['hello', 'wave', 'hi'],
  },
  {
    id: 'wow-shock',
    label: 'Shocked',
    url: 'https://media.giphy.com/media/3kzJvEciJa94SMW3hN/giphy.gif',
    keywords: ['shock', 'wow', 'surprised'],
  },
  {
    id: 'clap-fast',
    label: 'Clapping',
    url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif',
    keywords: ['clap', 'nice', 'great'],
  },
  {
    id: 'crying',
    label: 'Crying',
    url: 'https://media.giphy.com/media/OPU6wzx8JrHna/giphy.gif',
    keywords: ['sad', 'cry', 'tears'],
  },
  {
    id: 'hearts',
    label: 'Hearts',
    url: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif',
    keywords: ['love', 'heart', 'cute'],
  },
  {
    id: 'mindblown-2',
    label: 'Mind blown 2',
    url: 'https://media.giphy.com/media/xUPGcguWZHRC2HyBRS/giphy.gif',
    keywords: ['mind', 'blown', 'wow'],
  },
  {
    id: 'salute',
    label: 'Salute',
    url: 'https://media.giphy.com/media/13CoXDiaCcCoyk/giphy.gif',
    keywords: ['respect', 'salute', 'ok'],
  },
  {
    id: 'thank-you',
    label: 'Thank you',
    url: 'https://media.giphy.com/media/3oEdva9BUHPIs2SkGk/giphy.gif',
    keywords: ['thanks', 'grateful'],
  },
  {
    id: 'dance',
    label: 'Dance',
    url: 'https://media.giphy.com/media/3o7TKVSE5isogWqnwk/giphy.gif',
    keywords: ['dance', 'party', 'happy'],
  },
  {
    id: 'excited',
    label: 'Excited',
    url: 'https://media.giphy.com/media/oF5oUYTOhvFnO/giphy.gif',
    keywords: ['excited', 'happy', 'yay'],
  },
  {
    id: 'nope',
    label: 'Nope',
    url: 'https://media.giphy.com/media/jnQYWZ0T4mkhCmkzcn/giphy.gif',
    keywords: ['no', 'deny', 'reject'],
  },
  {
    id: 'yes',
    label: 'Yes',
    url: 'https://media.giphy.com/media/l4FGpP4lxGGgK5CBW/giphy.gif',
    keywords: ['yes', 'approve', 'agree'],
  },
  {
    id: 'suspicious',
    label: 'Suspicious',
    url: 'https://media.giphy.com/media/a5viI92PAF89q/giphy.gif',
    keywords: ['sus', 'suspicious', 'hmm'],
  },
  {
    id: 'typing-fast',
    label: 'Typing fast',
    url: 'https://media.giphy.com/media/ule4vhcY1xEKQ/giphy.gif',
    keywords: ['typing', 'busy', 'work'],
  },
  {
    id: 'celebrate-hard',
    label: 'Celebrate',
    url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
    keywords: ['celebrate', 'win', 'party'],
  },
  {
    id: 'love-you',
    label: 'Love you',
    url: 'https://media.giphy.com/media/eHpWHuEUxHIre/giphy.gif',
    keywords: ['love', 'heart', 'cute'],
  },
  {
    id: 'facepalm-2',
    label: 'Facepalm 2',
    url: 'https://media.giphy.com/media/3xz2BLBOt13X9AgjEA/giphy.gif',
    keywords: ['facepalm', 'oops', 'fail'],
  },
  {
    id: 'thumbs-up-cat',
    label: 'Cat thumbs up',
    url: 'https://media.giphy.com/media/MDJ9IbxxvDUQM/giphy.gif',
    keywords: ['cat', 'approve', 'yes'],
  },
  {
    id: 'mindblown-3',
    label: 'Mind blown 3',
    url: 'https://media.giphy.com/media/f9eYHQ8RZ4zfc4unXx/giphy.gif',
    keywords: ['wow', 'mindblown', 'shock'],
  },
  {
    id: 'laugh-cry',
    label: 'Laugh cry',
    url: 'https://media.giphy.com/media/Q7ozWVYCR0nyW2rvPW/giphy.gif',
    keywords: ['laugh', 'funny', 'lol'],
  },
  {
    id: 'applause-2',
    label: 'Applause 2',
    url: 'https://media.giphy.com/media/YRuFixSNWFVcXaxpmX/giphy.gif',
    keywords: ['applause', 'clap', 'great'],
  },
  {
    id: 'good-morning',
    label: 'Good morning',
    url: 'https://media.giphy.com/media/3o7btXJrqLo5bbtQDm/giphy.gif',
    keywords: ['morning', 'hello', 'hi'],
  },
  {
    id: 'good-night',
    label: 'Good night',
    url: 'https://media.giphy.com/media/l0HlBO7eyXzSZkJri/giphy.gif',
    keywords: ['night', 'sleep', 'bye'],
  },
  {
    id: 'angry',
    label: 'Angry',
    url: 'https://media.giphy.com/media/11tTNkNy1SdXGg/giphy.gif',
    keywords: ['angry', 'rage', 'mad'],
  },
  {
    id: 'confused',
    label: 'Confused',
    url: 'https://media.giphy.com/media/WRQBXSCnEFJIuxktnw/giphy.gif',
    keywords: ['confused', 'huh', 'what'],
  },
  {
    id: 'eyes-roll',
    label: 'Eye roll',
    url: 'https://media.giphy.com/media/3oEjI67Egb8G9jqs3m/giphy.gif',
    keywords: ['eyeroll', 'annoyed', 'ugh'],
  },
  {
    id: 'nodding',
    label: 'Nodding',
    url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif',
    keywords: ['yes', 'nod', 'agree'],
  },
  {
    id: 'shrug',
    label: 'Shrug',
    url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif',
    keywords: ['shrug', 'idk', 'whatever'],
  },
  {
    id: 'bravo',
    label: 'Bravo',
    url: 'https://media.giphy.com/media/nbvFVPiEiJH6JOGIok/giphy.gif',
    keywords: ['bravo', 'clap', 'nice'],
  },
  {
    id: 'heart-eyes',
    label: 'Heart eyes',
    url: 'https://media.giphy.com/media/1hqb8LwPS2xCNCpWH8/giphy.gif',
    keywords: ['love', 'heart', 'cute'],
  },
  {
    id: 'sleep',
    label: 'Sleep',
    url: 'https://media.giphy.com/media/3orieQx8j0hL4l2F0Q/giphy.gif',
    keywords: ['sleep', 'tired', 'night'],
  },
  {
    id: 'coffee',
    label: 'Coffee',
    url: 'https://media.giphy.com/media/l4FGI8GoTL7N4DsyI/giphy.gif',
    keywords: ['coffee', 'morning', 'work'],
  },
  {
    id: 'mic-drop',
    label: 'Mic drop',
    url: 'https://media.giphy.com/media/15BuyagtKucHm/giphy.gif',
    keywords: ['micdrop', 'win', 'done'],
  },
  {
    id: 'ok-hand',
    label: 'OK',
    url: 'https://media.giphy.com/media/3o7abKhOpu0NwenH3O/giphy.gif',
    keywords: ['ok', 'good', 'approve'],
  },
  {
    id: 'blush',
    label: 'Blush',
    url: 'https://media.giphy.com/media/xTiTnMhJTwNHChdTZS/giphy.gif',
    keywords: ['blush', 'cute', 'shy'],
  },
  {
    id: 'panic',
    label: 'Panic',
    url: 'https://media.giphy.com/media/14ut8PhnIwzros/giphy.gif',
    keywords: ['panic', 'stress', 'scared'],
  },
  {
    id: 'peace-out',
    label: 'Peace out',
    url: 'https://media.giphy.com/media/xUPGcjQ6dJEjH5uwMw/giphy.gif',
    keywords: ['bye', 'peace', 'later'],
  },
]

export const STICKER_OPTIONS: StickerOption[] = [
  {
    id: 'party-popper',
    label: 'Party',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f389.png',
    keywords: ['party', 'celebrate', 'yay'],
  },
  {
    id: 'smiling-hearts',
    label: 'Love',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f970.png',
    keywords: ['love', 'heart', 'cute'],
  },
  {
    id: 'rolling-laugh',
    label: 'Laugh',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f923.png',
    keywords: ['lol', 'laugh', 'funny'],
  },
  {
    id: 'mind-blown',
    label: 'Wow',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f92f.png',
    keywords: ['wow', 'shocked'],
  },
  {
    id: 'heart',
    label: 'Heart',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2764.png',
    keywords: ['heart', 'love'],
  },
  {
    id: 'fire',
    label: 'Fire',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png',
    keywords: ['fire', 'lit', 'hot'],
  },
  {
    id: 'thumbs-up',
    label: 'Approve',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44d.png',
    keywords: ['ok', 'approve', 'yes'],
  },
  {
    id: 'sparkles',
    label: 'Sparkles',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2728.png',
    keywords: ['sparkle', 'shine', 'clean'],
  },
  {
    id: 'check',
    label: 'Check',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2705.png',
    keywords: ['check', 'done', 'ok'],
  },
  {
    id: 'cross',
    label: 'Nope',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/274c.png',
    keywords: ['no', 'deny', 'wrong'],
  },
  {
    id: 'eyes',
    label: 'Eyes',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f440.png',
    keywords: ['watch', 'look', 'eyes'],
  },
  {
    id: 'rocket',
    label: 'Rocket',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f680.png',
    keywords: ['launch', 'ship', 'go'],
  },
  {
    id: 'zap',
    label: 'Zap',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/26a1.png',
    keywords: ['fast', 'electric', 'energy'],
  },
  {
    id: 'thinking',
    label: 'Thinking',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f914.png',
    keywords: ['think', 'hmm', 'idea'],
  },
  {
    id: 'pleading',
    label: 'Please',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f97a.png',
    keywords: ['please', 'beg', 'cute'],
  },
  {
    id: 'angry',
    label: 'Angry',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f621.png',
    keywords: ['angry', 'mad', 'rage'],
  },
  {
    id: 'cry',
    label: 'Sad',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f622.png',
    keywords: ['sad', 'cry', 'tears'],
  },
  {
    id: 'cool',
    label: 'Cool',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f60e.png',
    keywords: ['cool', 'nice', 'style'],
  },
  {
    id: 'party-face',
    label: 'Party Face',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f973.png',
    keywords: ['party', 'celebrate'],
  },
  {
    id: 'muscle',
    label: 'Strong',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4aa.png',
    keywords: ['strong', 'power', 'win'],
  },
  {
    id: 'pray',
    label: 'Thanks',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f64f.png',
    keywords: ['thanks', 'pray', 'respect'],
  },
  {
    id: 'wave',
    label: 'Hello',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44b.png',
    keywords: ['hello', 'wave', 'hi'],
  },
  {
    id: 'fireworks',
    label: 'Fireworks',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f386.png',
    keywords: ['fireworks', 'celebrate'],
  },
  {
    id: 'star',
    label: 'Star',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2b50.png',
    keywords: ['star', 'favorite', 'gold'],
  },
  {
    id: 'party-hat',
    label: 'Celebrate',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f973.png',
    keywords: ['party', 'celebrate', 'fun'],
  },
  {
    id: 'rocket-launch',
    label: 'Launch',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f680.png',
    keywords: ['rocket', 'launch', 'ship'],
  },
  {
    id: 'trophy',
    label: 'Winner',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3c6.png',
    keywords: ['win', 'trophy', 'champion'],
  },
  {
    id: 'medal',
    label: 'Top',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f947.png',
    keywords: ['gold', 'top', 'winner'],
  },
  {
    id: 'clap',
    label: 'Clap',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f44f.png',
    keywords: ['clap', 'applause', 'nice'],
  },
  {
    id: 'sunglasses',
    label: 'Cool',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f60e.png',
    keywords: ['cool', 'style', 'nice'],
  },
  {
    id: 'robot',
    label: 'Bot',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f916.png',
    keywords: ['robot', 'bot', 'tech'],
  },
  {
    id: 'alien',
    label: 'Alien',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f47d.png',
    keywords: ['alien', 'space', 'fun'],
  },
  {
    id: 'sleepy',
    label: 'Sleepy',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f62a.png',
    keywords: ['sleep', 'tired', 'night'],
  },
  {
    id: 'wink',
    label: 'Wink',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f609.png',
    keywords: ['wink', 'hint', 'flirt'],
  },
  {
    id: 'halo',
    label: 'Angel',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f607.png',
    keywords: ['angel', 'good', 'halo'],
  },
  {
    id: 'eyes-big',
    label: 'Watching',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f440.png',
    keywords: ['watching', 'eyes', 'look'],
  },
  {
    id: 'idea',
    label: 'Idea',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4a1.png',
    keywords: ['idea', 'smart', 'light'],
  },
  {
    id: 'warning',
    label: 'Warning',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/26a0.png',
    keywords: ['warning', 'alert', 'careful'],
  },
  {
    id: 'gift',
    label: 'Gift',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f381.png',
    keywords: ['gift', 'present', 'surprise'],
  },
  {
    id: 'music',
    label: 'Music',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3b5.png',
    keywords: ['music', 'song', 'sound'],
  },
  {
    id: 'coffee-cup',
    label: 'Coffee',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2615.png',
    keywords: ['coffee', 'morning', 'drink'],
  },
  {
    id: 'cake',
    label: 'Cake',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f370.png',
    keywords: ['cake', 'birthday', 'sweet'],
  },
  {
    id: 'cookie',
    label: 'Cookie',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f36a.png',
    keywords: ['cookie', 'sweet', 'dessert'],
  },
  {
    id: 'spark-heart',
    label: 'Spark Heart',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f496.png',
    keywords: ['heart', 'love', 'sparkle'],
  },
  {
    id: 'broken-heart',
    label: 'Broken Heart',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f494.png',
    keywords: ['heart', 'sad', 'break'],
  },
  {
    id: '100',
    label: 'Perfect',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4af.png',
    keywords: ['100', 'perfect', 'real'],
  },
  {
    id: 'check-green',
    label: 'Approved',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/2705.png',
    keywords: ['approve', 'check', 'yes'],
  },
  {
    id: 'cross-red',
    label: 'Rejected',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/274c.png',
    keywords: ['reject', 'no', 'stop'],
  },
  {
    id: 'camera',
    label: 'Camera',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f4f7.png',
    keywords: ['camera', 'photo', 'media'],
  },
  {
    id: 'video',
    label: 'Video',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3a5.png',
    keywords: ['video', 'movie', 'camera'],
  },
  {
    id: 'microphone',
    label: 'Mic',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3a4.png',
    keywords: ['mic', 'voice', 'audio'],
  },
  {
    id: 'headphones',
    label: 'Headphones',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f3a7.png',
    keywords: ['headphones', 'music', 'audio'],
  },
  {
    id: 'rocket-blue',
    label: 'Ship it',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f680.png',
    keywords: ['ship', 'rocket', 'launch'],
  },
  {
    id: 'fire-blue',
    label: 'Lit',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f525.png',
    keywords: ['fire', 'lit', 'hot'],
  },
  {
    id: 'eyes-side',
    label: 'Seen',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/1f440.png',
    keywords: ['seen', 'watch', 'look'],
  },
  {
    id: 'peace-hand',
    label: 'Peace',
    imageUrl: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/270c.png',
    keywords: ['peace', 'bye', 'later'],
  },
]

export function getAllEmojiOptions(): EmojiOption[] {
  return dedupeEmojiOptions(EMOJI_CATEGORIES.flatMap((category) => category.emojis))
}

export function getReactionModeEmojiOptions(): EmojiOption[] {
  const quickMap = new Map(EMOJI_REACTION_OPTIONS.map((entry) => [entry.emoji, entry]))
  const combined: EmojiOption[] = [...EMOJI_REACTION_OPTIONS]
  for (const entry of getAllEmojiOptions()) {
    if (quickMap.has(entry.emoji)) continue
    combined.push(entry)
  }
  return dedupeEmojiOptions(combined)
}

export function filterEmojiOptions(query: string, categoryId?: string): EmojiOption[] {
  const normalized = query.trim().toLowerCase()
  const source = categoryId
    ? EMOJI_CATEGORIES.find((category) => category.id === categoryId)?.emojis ?? []
    : getAllEmojiOptions()
  if (!normalized) return source
  return source.filter((entry) => {
    if (entry.label.includes(normalized)) return true
    return entry.keywords.some((keyword) => keyword.includes(normalized))
  })
}

export function filterGifOptions(query: string): GifOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return GIF_OPTIONS
  return GIF_OPTIONS.filter((entry) =>
    entry.label.toLowerCase().includes(normalized) ||
    entry.keywords.some((keyword) => keyword.includes(normalized)),
  )
}

export function filterStickerOptions(query: string): StickerOption[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return STICKER_OPTIONS
  return STICKER_OPTIONS.filter((entry) =>
    entry.label.toLowerCase().includes(normalized) ||
    entry.keywords.some((keyword) => keyword.includes(normalized)),
  )
}
