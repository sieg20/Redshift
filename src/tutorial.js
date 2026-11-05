// How to Play: a few pages of screenshots and short notes on the mechanics. Opened from the
// menu or the pause screen, and shown once before the first run. The screenshots live in
// public/tutorial/ and can be refreshed from the game with captureShot() (see main.js).

const SEEN_KEY = 'redshift.tutorialSeen';

const k = (s) => `<kbd>${s}</kbd>`;
const shot = (name, alt) => `<img src="tutorial/${name}.jpg" alt="${alt}" loading="lazy" draggable="false" />`;
// a label pinned to a point on a screenshot (percentages of its width and height)
const tag = (text, x, y, cls = '') => `<span class="tut-tag ${cls}" style="left:${x}%;top:${y}%">${text}</span>`;

const PAGES = [
  {
    title: 'FLY THE RINGS',
    media: `<figure class="tut-shot">${shot('rings', 'The craft on the road with a line of rings ahead and red walls beside it')}
      ${tag('RING', 50, 42, 'c')}${tag('WALL', 35, 47, 'r')}</figure>`,
    body: `<ul>
      <li>Steer with ${k('A')}${k('D')} or ${k('&larr;')}${k('&rarr;')}. On a touch screen, hold the left or right third of the screen.</li>
      <li><b class="c">Rings</b> arrive on the beat of the music. Fly through them to build your <b class="g">combo</b>. Get roughly lined up and the craft eases you in.</li>
      <li>Miss a ring and your combo drops. Hit a <b class="r">wall</b> and you lose speed and half your combo. Skim past one for a <b>CLOSE CALL</b> bonus.</li>
    </ul>`,
  },
  {
    title: 'BOOST ON THE BEAT',
    media: `<figure class="tut-shot">${shot('boost', 'The craft boosting, the road rippling around it')}${tag('BOOST', 50, 60, 'g')}</figure>`,
    body: `<div class="tut-timing" aria-label="Boost timing: perfect within 60 milliseconds of the beat, good within 120">
        <span class="off">OFF-BEAT</span><span class="good">GOOD</span><span class="perfect">PERFECT</span><span class="good">GOOD</span><span class="off">OFF-BEAT</span>
        <i class="beat"></i><em>the beat</em>
      </div>
      <ul>
      <li>Press ${k('SPACE')} to boost (or tap the middle of the screen). Time it <b>on the beat</b>: within 60 ms is <b class="g">PERFECT</b>, within 120 ms is <b class="c">GOOD</b>. The circle next to your speed closes in on every beat.</li>
      <li>Perfect boosts push you furthest and score the most.</li>
      <li>Each boost uses <b class="c">FLUX</b>, the bar under your combo. It refills slowly on its own and a bit with every ring.</li>
    </ul>`,
  },
  {
    title: 'GO FASTER',
    media: `<div class="tut-grid">
        <figure>${shot('rings', 'Cruise: the road at dusk')}<figcaption>CRUISE &middot; BLUR &middot; MIRAGE</figcaption></figure>
        <figure>${shot('tier-sonic', 'Sonic: breaking the sound barrier')}<figcaption>SONIC</figcaption></figure>
        <figure>${shot('tier-warp', 'Warp: the road curls into a tunnel')}<figcaption>WARP</figcaption></figure>
        <figure>${shot('tier-sing', 'Singularity: space folds around the craft')}<figcaption class="m">SINGULARITY</figcaption></figure>
      </div>`,
    body: `<ul>
      <li>Your combo sets the speed you can hold. At max combo, every ring and perfect boost charges <b class="m">OVERDRIVE</b>, the only way past SONIC into WARP and SINGULARITY.</li>
      <li>There are six speed tiers. The world changes at each one, from heat haze to a sonic boom to space curling into a tunnel.</li>
      <li>Faster tiers score more just for flying, up to &times;6. Your combo multiplies ring and boost points.</li>
    </ul>`,
  },
  {
    title: 'RIDE THE DROP',
    media: `<div class="tut-grid two">
        <figure>${shot('drop-hang', 'The build-up: a straight line of rings into a portal')}<figcaption>THE BUILD-UP</figcaption></figure>
        <figure>${shot('drop-wormhole', 'Inside the wormhole after the drop')}<figcaption class="g">THE DROP</figcaption></figure>
      </div>`,
    body: `<ul>
      <li>When the music is about to drop, <b>DROP INCOMING</b> appears and the rings line up straight into a <b class="g">portal</b>. A countdown runs, then time slows to a crawl.</li>
      <li>Fly the whole build-up without a miss or crash for a <b class="g">PERFECT DROP</b>: a bonus and a bigger speed surge.</li>
      <li>Through the portal you get 16 beats in the wormhole at <b class="g">double score</b>, then a giant exit portal throws you back out.</li>
    </ul>`,
  },
  {
    title: 'YOUR OWN MUSIC',
    media: `<figure class="tut-shot">${shot('music', 'The level intro: the craft passing a black hole')}</figure>`,
    body: `<ul>
      <li><b>USE YOUR OWN MUSIC</b> on the menu plays any mp3, ogg or wav file. It stays on your device.</li>
      <li>The game works out the tempo, the beats and the drops by itself, and puts rings on the hits you hear.</li>
      <li>If the rings feel early or late, nudge the sync with ${k('[')} ${k(']')} during a run.</li>
      <li class="dim">${k('ESC')} pause &nbsp; ${k('M')} mute &nbsp; ${k('-')}${k('=')} volume</li>
    </ul>`,
  },
];

export class Tutorial {
  constructor() {
    this.el = document.getElementById('tutorial');
    this.el.innerHTML = `
      <div class="tut-card" role="dialog" aria-modal="true" aria-labelledby="tut-title">
        <div class="tut-head">
          <span class="tut-label">HOW TO PLAY</span>
          <span class="tut-count"></span>
          <button class="tut-close" type="button" aria-label="Close">&times;</button>
        </div>
        <div class="tut-page"></div>
        <div class="tut-nav">
          <button class="btn tut-prev" type="button">BACK</button>
          <div class="tut-dots">${PAGES.map((_, i) => `<button type="button" aria-label="Page ${i + 1}" data-i="${i}"></button>`).join('')}</div>
          <button class="btn primary tut-next" type="button">NEXT</button>
        </div>
      </div>`;
    this.page = this.el.querySelector('.tut-page');
    this.count = this.el.querySelector('.tut-count');
    this.prevBtn = this.el.querySelector('.tut-prev');
    this.nextBtn = this.el.querySelector('.tut-next');
    this.dots = [...this.el.querySelectorAll('.tut-dots button')];
    this.prevBtn.addEventListener('click', () => this.go(this.i - 1));
    this.nextBtn.addEventListener('click', () => (this.i < PAGES.length - 1 ? this.go(this.i + 1) : this.close()));
    this.el.querySelector('.tut-close').addEventListener('click', () => this.close());
    this.dots.forEach((d) => d.addEventListener('click', () => this.go(Number(d.dataset.i))));
    this.el.addEventListener('click', (e) => e.target === this.el && this.close());
    addEventListener(
      'keydown',
      (e) => {
        if (!this.isOpen) return;
        if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'Space') this.nextBtn.click();
        else if (e.code === 'ArrowLeft') this.go(this.i - 1);
        else if (e.code === 'Escape') this.close();
        else return;
        e.preventDefault();
        e.stopImmediatePropagation(); // the game doesn't see keys meant for the tutorial
      },
      true
    );
    this.i = 0;
    this.isOpen = false;
  }

  static get seen() {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch (e) {
      return true; // no storage: don't keep forcing it on every run
    }
  }

  // `then` runs when the tutorial is closed; `finish` labels the last page's button.
  open({ then = null, finish = 'DONE' } = {}) {
    this.then = then;
    this.finish = finish;
    this.isOpen = true;
    this.el.classList.remove('hidden');
    this.go(0);
    this.nextBtn.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch (e) {
      /* storage unavailable */
    }
    const then = this.then;
    this.then = null;
    if (then) then();
  }

  go(i) {
    this.i = Math.max(0, Math.min(PAGES.length - 1, i));
    const p = PAGES[this.i];
    this.page.innerHTML = `<div class="tut-media">${p.media}</div><h3 id="tut-title">${p.title}</h3><div class="tut-body">${p.body}</div>`;
    this.count.textContent = `${this.i + 1} / ${PAGES.length}`;
    this.prevBtn.disabled = this.i === 0;
    this.nextBtn.textContent = this.i === PAGES.length - 1 ? this.finish : 'NEXT';
    this.dots.forEach((d, j) => d.classList.toggle('on', j === this.i));
    this.page.scrollTop = 0;
  }
}
