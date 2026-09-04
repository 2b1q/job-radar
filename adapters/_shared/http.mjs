// _shared/http.mjs - the transport habits every adapter needs, with the values
// each board sets for itself.
//
// The mechanism is shared; the numbers are not. Boards differ in what they
// tolerate, and one of them proved it by answering 401 across the whole address
// after about thirty requests in an hour. Flattening the throttle to a single
// constant would trade a real difference for a tidier file.

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One pool, because the differences between the three per-adapter lists were
// accidental rather than measured - unlike the timings below, which encode what
// a particular board was observed to tolerate.
export const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
];

export const LANGS = [
  'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
  'en-US,en;q=0.9,ru;q=0.8',
  'ru,en-US;q=0.9,en;q=0.8',
];

/**
 * A per-board transport. Each adapter keeps its own counter and its own
 * timings; what they share is the shape.
 *
 * The counter matters on its own: throttling with jitter bounds the RATE, and
 * nothing bounded the total, which is what a board actually meters. Exposed so
 * the server can record it per run and turn an invisible budget into a measured
 * one.
 */
// The ceiling for one tool call, across every page, lookup and enrichment it
// makes. It exists because the rate was the only thing bounded: a single call
// that pages deeply and then enriches can spend dozens of requests without any
// one of them looking wrong, and the board meters the total. 150 requests in a
// session drew no refusal; roughly half that did, once. Two observations are not
// a limit, so this is a stop, not a model of the board.
export const MAX_REQUESTS_PER_CALL = 40;

export function createHttp({ userAgents = USER_AGENTS, throttleMs, jitterMs, baseHeaders = {} }) {
  let requests = 0;
  let spent = 0;
  let cap = null;
  let what = 'this call';
  return {
    requestCount: () => requests,
    /**
     * Open a budget for one tool call. Until it is called the transport is
     * uncapped, which is what a smoke script or a one-off probe wants.
     */
    beginCall(label = 'this call', limit = MAX_REQUESTS_PER_CALL) {
      spent = 0;
      cap = limit;
      what = label;
    },
    endCall() { cap = null; return spent; },
    countRequest() {
      requests += 1;
      spent += 1;
      // Thrown, never silently truncated: a short answer that looks complete is
      // how "the niche is empty" gets read off a run that simply stopped.
      if (cap !== null && spent > cap) {
        cap = null;   // so the throw itself is not re-thrown by a cleanup path
        throw new Error(`budget: ${what} hit the ceiling of ${spent - 1} requests. `
          + 'The answer would be incomplete, so nothing is returned. Narrow the '
          + 'query, ask for fewer pages, or raise MAX_REQUESTS_PER_CALL knowing '
          + 'the board meters the total.');
      }
    },
    throttle: () => sleep(throttleMs + Math.floor(Math.random() * jitterMs)),
    headers(extra = {}) {
      return {
        'user-agent': pick(userAgents),
        'accept-language': pick(LANGS),
        'dnt': '1',
        ...baseHeaders,
        ...extra,
      };
    },
  };
}
