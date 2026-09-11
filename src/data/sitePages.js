const EMPTY_HOUSES = {
  kicker: 'Empty',
  title: 'Nothing listed yet.',
  copy: 'Collections expand from the atelier — or begin a strand in the studio.',
  primaryCta: { label: 'Customization', to: '/customize' },
  secondaryCta: { label: 'Shop All', to: '/shop' },
};

const PAGES_DEFAULTS = {
  shop: {
    eyebrow: 'The collection',
    title: 'Shop All',
    body: 'Ready-made pieces across crystals, rudraksha and gemstones.',
    familyBody: 'Ready-made pieces from the house of {house}.',
    action: 'Customization →',
    to: '/customize',
    empty: {
      kicker: 'Empty',
      title: 'No pieces listed yet.',
      copy: 'Begin a custom strand, or enter one of the three houses.',
      primaryCta: { label: 'Customization', to: '/customize' },
      secondaryCta: { label: 'The houses', to: '/crystals' },
    },
  },
  family: {
    shopAction: 'Shop all →',
    shopTo: '/shop',
    piecesEyebrow: 'The collection',
    piecesTitle: 'Pieces',
    piecesBody: '{count} {pieces} from this house.',
    piecesAction: 'Customization →',
    piecesTo: '/customize',
    empty: EMPTY_HOUSES,
  },
  category: {
    action: 'Customization →',
    to: '/customize',
    missing: {
      kicker: 'Missing',
      title: 'Collection not found.',
      copy: 'This category is not published yet.',
      primaryCta: { label: 'Shop All', to: '/shop' },
      secondaryCta: { label: 'Customization', to: '/customize' },
    },
    empty: {
      kicker: 'Empty',
      title: 'No pieces here yet.',
      copy: 'The atelier will add them — or compose a strand in the studio.',
      primaryCta: { label: 'Customization', to: '/customize' },
      secondaryCta: { label: 'Shop All', to: '/shop' },
    },
  },
  product: {
    missing: {
      kicker: 'Missing',
      title: 'Piece not found.',
      copy: 'This work is no longer listed. Walk the houses, or begin in the studio.',
      primaryCta: { label: 'Shop All', to: '/shop' },
      secondaryCta: { label: 'Customization', to: '/customize' },
    },
  },
  customize: {
    steps: [
      {
        eyebrow: 'The studio',
        title: 'Choose a purpose',
        body: 'Begin with why you wear it. One purpose opens its intentions — calm, abundance, protection, or love.',
      },
      {
        eyebrow: 'Step 02 · Intention',
        title: 'Choose an intention',
        body: 'Click an intention. Its crystals open so you can keep or release them, then continue.',
      },
      {
        eyebrow: 'Step 03 · Birth',
        title: 'Date of birth',
        body: 'Mulank is taken from the day. The strand is composed to that number.',
      },
      {
        eyebrow: 'Step 04 · Zodiac',
        title: 'Zodiac beads',
        body: 'Your sign’s stone is added beside the charm. The repeating pattern stays fixed.',
      },
      {
        eyebrow: 'Step 05 · Name',
        title: 'Charm & thread',
        body: 'Sriyantra or Om at the clasp. Korean elastic is free size; steel core is sized to the wrist.',
      },
      {
        eyebrow: 'Step 06 · Review',
        title: 'Review & order',
        body: 'Confirm the composition. Place the piece in your bag, then continue to checkout.',
      },
    ],
  },
  aboutPage: {
    eyebrow: 'The house',
    action: 'Customization →',
    to: '/customize',
    image: '',
  },
  cart: {
    eyebrow: 'The atelier',
    title: 'Bag',
    emptyBody: 'Your bag is empty. Begin a custom strand, or walk the three houses until a piece finds you.',
    filledBody: '{count} {pieces} held for checkout — ready-made or composed in the studio.',
    action: 'Shop all →',
    to: '/shop',
    empty: {
      kicker: 'Empty',
      title: 'Your bag is empty.',
      copy: 'Begin a custom strand or browse the houses.',
      primaryCta: { label: 'Customization', to: '/customize' },
      secondaryCta: { label: 'Shop All', to: '/shop' },
    },
  },
  wishlist: {
    eyebrow: 'The atelier',
    title: 'Wishlist',
    emptyBody: 'Save pieces you love. They wait here until you are ready.',
    filledBody: '{count} saved {pieces} — held here until you are ready.',
    action: 'Shop all →',
    to: '/shop',
    empty: {
      kicker: 'Empty',
      title: 'Nothing saved yet.',
      copy: 'Begin in the houses, or compose a strand in the studio.',
      primaryCta: { label: 'Shop All', to: '/shop' },
      secondaryCta: { label: 'Customization', to: '/customize' },
    },
  },
  checkout: {
    title: 'Checkout',
    body: 'Payment will open in the next step — coming soon. This places a pending-payment order so fulfilment can be prepared.',
    emptyTitle: 'Nothing to check out',
    emptyBody: 'Add a piece first.',
    submitLabel: 'Place pending order',
    submitBusy: 'Placing…',
    summaryTitle: 'Summary',
  },
  login: {
    eyebrow: 'The atelier',
    title: 'Sign in',
    body: 'One account for the store and the atelier. Your bag and wishlist travel with you.',
    action: 'Create account →',
    to: '/register',
    cardKicker: 'Welcome back',
    cardTitle: 'Enter the house.',
    submitLabel: 'Sign in',
    submitBusy: 'Signing in…',
    footer: 'New here?',
    footerLink: 'Create an account',
  },
  register: {
    eyebrow: 'The atelier',
    title: 'Create account',
    body: 'Join the house. A custom strand, a saved piece, and the atelier list — kept under one name.',
    action: 'Sign in →',
    to: '/login',
    cardKicker: 'Begin',
    cardTitle: 'A place in the house.',
    submitLabel: 'Create account',
    submitBusy: 'Creating…',
    footer: 'Already with us?',
    footerLink: 'Sign in',
  },
  account: {
    eyebrow: 'The atelier',
    title: 'Account',
    guestBody: 'Your orders and atelier stay under one name.',
    action: 'Shop all →',
    to: '/shop',
    cardKicker: 'Session',
    cardTitle: 'Your house.',
    ordersEyebrow: 'The collection',
    ordersTitle: 'Orders',
    ordersLoading: 'Fetching your orders.',
    ordersEmptyBody: 'No orders yet. Begin a custom strand or walk the houses.',
    ordersFilledBody: '{count} {orders} held in the atelier.',
    ordersAction: 'Customization →',
    placedKicker: 'Placed',
    placedBody: 'Order {number} is held as pending payment. Gateway checkout arrives in the next release.',
    empty: {
      kicker: 'Empty',
      title: 'No orders yet.',
      copy: 'Begin a custom strand, or choose a ready-made piece from the houses.',
      primaryCta: { label: 'Customization', to: '/customize' },
      secondaryCta: { label: 'Shop All', to: '/shop' },
    },
  },
  notFound: {
    title: 'Page not found',
    body: 'This path is not part of the Kuberstones house.',
    cta: 'Return home',
    to: '/',
  },
  legal: {
    returns: {
      title: 'Return & Exchange',
      eyebrow: 'Care',
      body: 'Ready-made pieces have a short window. Custom strands, made to your purpose, are made to order.',
      sections: [
        {
          heading: 'Window',
          body: 'Ready-made pieces may be returned or exchanged within 7 days of delivery, unused, with original packaging. Custom bracelets made to your purpose, intention, date of birth, and name are made to order and are not eligible for return, except for manufacturing defects.',
        },
        {
          heading: 'How to request',
          body: 'Write to us from the email on your account with the order number and whether you want a return or an exchange. We will share a pickup or drop-off instruction. Refunds, when approved, are issued to the original payment method after the piece is inspected.',
        },
        {
          heading: 'What we cannot accept',
          body: 'Worn, altered, or engraved pieces, items without tags or boxes, and custom studio strands cannot be exchanged for a different design. Crystal meaning is spiritual tradition, not a basis for return.',
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      eyebrow: 'Trust',
      body: 'We keep only what the atelier needs — to make the piece, fulfil the order, and hold your account.',
      sections: [
        {
          heading: 'What we collect',
          body: 'We collect the name, email, phone, and addresses you give us, along with order history, wishlist, and customization details such as date of birth used for Mulank. If you browse while signed in, we keep a session so your bag and account stay with you.',
        },
        {
          heading: 'How we use it',
          body: 'We use this information to fulfil orders, support your account, improve the atelier, and send order updates. We do not sell your personal data. Date of birth is used only to calibrate your bracelet and is not shared for marketing lists.',
        },
        {
          heading: 'Your choices',
          body: 'You may update your profile, request a copy of your data, or ask us to delete your account. Some records of completed orders are kept where the law requires. Contact us from the email on your account to make a request.',
        },
      ],
    },
    terms: {
      title: 'Terms & Conditions',
      eyebrow: 'The atelier',
      body: 'Kuberstones sells jewellery and custom bracelets for personal use. Prices are in Indian Rupees.',
      sections: [
        {
          heading: 'The store',
          body: 'Kuberstones sells jewellery and custom bracelets for personal use. Prices are in Indian Rupees. Product photos and 3D previews are a close guide; natural stones and handmade strands can vary slightly in tone and size.',
        },
        {
          heading: 'Orders & customization',
          body: 'Placing an order is an offer to buy. Custom pieces begin once you confirm the studio steps. Crystal associations are traditional and spiritual; they are not medical claims and do not replace professional care.',
        },
        {
          heading: 'Accounts',
          body: 'You are responsible for the details on your account and for keeping your password private. We may refuse or cancel an order in case of pricing error, stock limits, or suspected misuse.',
        },
      ],
    },
  },
};

const FOOTER_DEFAULTS = {
  bannerImage: '',
  kicker: 'The atelier',
  title: 'New strands, written quietly.',
  copy: 'Collections, studio notes, and the occasional ritual. No noise.',
  cta: 'Contact us',
  brandName: 'KUBERSTONES',
  blurb: 'Heal. Align. Attract abundance. Jewellery composed for intention — crystals, rudraksha, and gemstones, made by hand.',
  tagline: 'Energy · Abundance · Wellness',
  email: 'mailto:hello@kuberstones.com',
  instagram: 'https://instagram.com',
  location: 'India · Made to order',
  copyright: 'Kuberstones. All rights reserved.',
  disclaimer: 'Crystal associations are traditional and spiritual. They are not medical claims.',
};

const CONTACT_DEFAULTS = {
  eyebrow: 'The atelier',
  title: 'Contact us',
  body: 'Tell us how we may help — a piece, a custom strand, or a quiet question.',
  submitLabel: 'Send the note',
  sentKicker: 'Received',
  sentTitle: 'We have your note.',
  sentBody: 'Thank you, {name}. The house will write back to {email}.',
};

module.exports = { PAGES_DEFAULTS, FOOTER_DEFAULTS, CONTACT_DEFAULTS };
