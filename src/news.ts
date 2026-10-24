/**
 * What Rachett News & Updates says today.
 *
 * The page is a fixed, versioned feed rather than a database collection: it is product writing,
 * not user data, and it should ship with the release that makes the claim true. Each post has a
 * date so old news stays old news.
 */
export type NewsPost = {
  id: string
  date: string
  tag: 'account' | 'safety' | 'market' | 'sellers'
  title: string
  body: string
}

export const NEWS_POSTS: NewsPost[] = [
  {
    id: 'phone-is-the-key',
    date: '24 Oct 2026',
    tag: 'account',
    title: 'Your phone number is the strongest key you have',
    body: 'It is how a code reaches you, how you get back in after a new SIM, and how your account earns the real-seller badge. In the markets rachett is built for, it is also the number mobile money is attached to. A Google email is a good second key; together they make an account you can always recover.',
  },
  {
    id: 'find-your-people',
    date: '24 Oct 2026',
    tag: 'market',
    title: 'Find the people you already know',
    body: 'A market is better when your people are in it. Tap Find friends on this page, choose contacts in your phone’s own picker, and we will show you who is already on rachett. We never store your address book: each number becomes a one-way code for the check, and we keep only that you agreed and how many friends were found.',
  },
  {
    id: 'strong-account',
    date: '24 Oct 2026',
    tag: 'safety',
    title: 'One way in is good. Two is stronger.',
    body: 'If you signed in with Google, add a phone. If you signed in with a phone, add a Google email. The second key is what keeps you in your account when a number changes, and it is what makes a seller’s badge mean something to a buyer.',
  },
  {
    id: 'phone-first-africa',
    date: '24 Oct 2026',
    tag: 'account',
    title: 'Phone-first, by design',
    body: 'In African markets we will occasionally remind an email-only account to add a phone number — nine days apart, on this page, never as a pop-up in the middle of an order. Outside those markets, email-only is a perfectly good account. The reminder is a nudge, not a gate.',
  },
  {
    id: 'seller-badge',
    date: '24 Oct 2026',
    tag: 'sellers',
    title: 'The real-seller badge is earned by receiving a code',
    body: 'No seller can give themselves the badge from a browser. The number is proved by our server after a text message comes back correct, and the proof is written where only the server can write. Buyers can trust that the green mark is about a real number, not a setting.',
  },
]
