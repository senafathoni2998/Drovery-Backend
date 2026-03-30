export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    id: '1',
    question: 'How do I track my delivery?',
    answer:
      'Go to the Delivery tab and tap on your active order. You will see real-time tracking on the map.',
  },
  {
    id: '2',
    question: 'How is the delivery price calculated?',
    answer:
      'Pricing is based on package size, weight, type, and a base service fee. Use the Price Estimate tool before placing an order.',
  },
  {
    id: '3',
    question: 'Can I cancel an order?',
    answer:
      'You can cancel an order before a drone is assigned. Once assigned, cancellation may incur a fee.',
  },
  {
    id: '4',
    question: 'What package sizes are available?',
    answer:
      'Small (up to 0.5 kg), Medium (up to 1.5 kg), Large (up to 3 kg), and XL (up to 5 kg).',
  },
  {
    id: '5',
    question: 'How do I change my default address?',
    answer:
      'Go to Profile \u2192 Edit Profile and update the Default Address field.',
  },
  {
    id: '6',
    question: 'Is my payment information secure?',
    answer:
      'Yes. All card data is encrypted via Stripe. We never store your full card number.',
  },
];
