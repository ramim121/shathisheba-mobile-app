/**
 * The three decisions the hold-to-talk gesture gets wrong.
 *
 * These are here, as pure functions with no imports, because one of them
 * shipped wrong and sent a farmer's recording to the server twice. The gesture
 * itself has to stay in the component — it needs the recorder, the permission
 * prompt and four pieces of React state — but the decisions do not, and a
 * decision that cannot be tested is a decision that gets re-argued from the
 * symptoms every time it is wrong.
 *
 * Tested from `ShathiShebaAdmin/scripts/test-apa.mjs`, which lifts this file by
 * source.
 */

/**
 * Is this release the tail of a tap that has already been dealt with?
 *
 * The tap-to-send path acts on `onPanResponderGrant`, because the send should
 * happen the instant her finger lands rather than when it leaves. The release
 * of that same tap then arrives at a handler which, by that point, sees
 * `latched: false` (the send cleared it) and a hold duration measured from the
 * *original* start of the recording — comfortably past any tap threshold. So
 * it fell through to the send a second time.
 */
export function releaseIsEcho(handledInGrant: boolean): boolean {
  return handledInGrant;
}

/**
 * Should letting go latch the microphone on instead of sending?
 *
 * Hold-to-talk is the gesture farmers know from WhatsApp, and it is also the
 * one gesture some of them cannot make — arthritis, a hand carrying a load, a
 * cracked screen that will not track a long press. A quick tap latches the
 * recording on instead and the next tap sends it. Both gestures, one button,
 * no setting to find.
 */
export function releaseLatches(o: {
  latched: boolean;
  cancelArmed: boolean;
  heldForMs: number;
  tapMs?: number;
}): boolean {
  if (o.latched) return false;
  // Swiping up to cancel and letting go is a cancel, however brief it was.
  if (o.cancelArmed) return false;
  return o.heldForMs < (o.tapMs ?? 450);
}

/**
 * May this recording go to the server?
 *
 * `startedAt` versus `sentAt` is the guard that actually stops the duplicate,
 * and it is keyed on when the recording began rather than on the file it
 * produced. A uri comparison would be the obvious thing and is the wrong
 * thing: if the recorder ever reuses a temporary file name, it would refuse to
 * send the *next* recording, which is a worse failure than the one being
 * fixed.
 */
export function maySend(o: {
  cancelled: boolean;
  seconds: number;
  uri: string | null;
  startedAt: number;
  sentAt: number;
  minSeconds?: number;
}): boolean {
  if (o.cancelled) return false;
  if (!o.uri) return false;
  // Under a second is a mis-tap, not a question. Transcribing it costs money
  // and returns nothing.
  if (o.seconds < (o.minSeconds ?? 1)) return false;
  // A recording that has never started cannot have been sent, and must not
  // match a `sentAt` that is also zero.
  if (o.startedAt <= 0) return false;
  return o.startedAt !== o.sentAt;
}
