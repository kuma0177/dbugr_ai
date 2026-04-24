export const MOCK_TRANSCRIPT = `[00:00] User opens the checkout page.
[00:03] User scrolls down to view the order summary.
[00:07] User clicks the "Place Order" button.
[00:08] Nothing happens. User clicks again.
[00:11] User hovers over the button, it appears disabled but shows no error.
[00:15] User tries to scroll back up to check if all fields are filled.
[00:20] User notices the "Apply Coupon" field is overlapping the CTA button on mobile viewport.
[00:25] User resizes browser — on desktop the button works fine.
[00:30] User says: "The checkout CTA is broken on mobile, the coupon field is overlapping it completely."`;

export const MOCK_SUMMARY = `The user encountered a critical UX issue on the checkout page where the coupon code input field visually overlaps the "Place Order" CTA button at mobile viewport widths. This makes it impossible to tap the checkout button on mobile, effectively blocking all mobile purchases. The issue does not reproduce on desktop.`;

export const MOCK_TASK_BRIEF = JSON.stringify({
  title: 'Fix: Checkout CTA blocked by coupon field on mobile',
  description:
    'The coupon code input field overlaps the Place Order button at viewports < 768px. ' +
    'The button becomes untappable, blocking mobile checkout entirely. ' +
    'Fix the layout so the coupon field and CTA button do not overlap at any viewport.',
  target: 'github',
  context: {
    affectedArea: 'checkout page',
    priority: 'high',
    reproSteps: [
      'Open checkout page on a mobile device or browser at < 768px width',
      'Scroll to the bottom CTA area',
      'Observe coupon field overlapping the Place Order button',
    ],
  },
});

export const MOCK_FRAMES = [
  { timestampMs: 0, imageUrl: '/mock/frame_0000.png', cursorX: 512, cursorY: 300, description: 'Checkout page opened' },
  { timestampMs: 7000, imageUrl: '/mock/frame_0007.png', cursorX: 900, cursorY: 680, clickType: 'click', description: 'User clicks Place Order button' },
  { timestampMs: 20000, imageUrl: '/mock/frame_0020.png', cursorX: 870, cursorY: 620, description: 'Coupon field overlapping CTA visible' },
];
