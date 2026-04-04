export type EmojiOption = {
  emoji: string
  label: string
  keywords: string[]
}

type EmojiCategory = {
  id: string
  label: string
  emojis: EmojiOption[]
}

function item(emoji: string, label: string, keywords: string[] = []): EmojiOption {
  return { emoji, label, keywords }
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: 'smileys',
    label: 'Smileys',
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
    ],
  },
  {
    id: 'people',
    label: 'People',
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
    ],
  },
  {
    id: 'hearts',
    label: 'Hearts',
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
    ],
  },
  {
    id: 'food',
    label: 'Food',
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
    ],
  },
  {
    id: 'activities',
    label: 'Activities',
    emojis: [
      item('🎉', 'party popper', ['party']),
      item('🎊', 'confetti ball', ['party']),
      item('🎁', 'wrapped gift', ['present']),
      item('🎈', 'balloon', ['party']),
      item('🎂', 'birthday cake', ['birthday']),
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
    ],
  },
  {
    id: 'travel',
    label: 'Travel',
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
    ],
  },
  {
    id: 'objects',
    label: 'Objects',
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

export function getAllEmojiOptions(): EmojiOption[] {
  return EMOJI_CATEGORIES.flatMap((category) => category.emojis)
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
