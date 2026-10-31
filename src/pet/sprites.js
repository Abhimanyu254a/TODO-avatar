'use strict';

/**
 * Pixel-art pets. Every frame is a grid of characters (facing right); each
 * character maps to a colour in the palette, '.' is transparent.
 * Frames share rows where they can: a frame is `top` rows + a `legs` variant.
 */
const SPRITES = (() => {
  // ---- cat ---------------------------------------------------------------
  const catTop = [
    '..............k...k.',
    '.............kpk.kpk',
    '..k..........koooook',
    '.kok.........koeoeok',
    '.kok.........koeoeok',
    '..kok........kolplok',
    '...kok.kkkkkkkollllk',
    '....kkooodooodookkk.',
    '.....koooodooodoook.',
    '.....kllooodoooooook',
    '.....klllooooooooook',
    '......kllllllllllkk.',
  ];
  const catTop2 = catTop.slice();
  catTop2[2] = '.kk..........koooook';
  catTop2[3] = 'kok..........koeoeok';
  catTop2[4] = 'kok..........koeoeok';
  catTop2[5] = '.kok.........kolplok';
  catTop2[6] = '..kkok.kkkkkkkollllk';

  const catLegs = {
    stand: ['......kok.kok.kok.k.', '......kok.kok.kok.k.', '......kok.kok.kok.k.', '.....kkk.kkk.kkk.kk.'],
    walkA: ['.....kok...kok..kok.', '....kok....kok...kok', '...kok.....kok....kk', '...kk......kk.......'],
    walkB: ['.......kok.kok.kok..', '.......kok..kok.kok.', '.......kok...kokkok.', '.......kk.....kk.kk.'],
  };

  const catSit = [
    '..........k...k.....',
    '.........kpk.kpk....',
    '.........kooooook...',
    '.........koeoeook...',
    '.........koeoeook...',
    '.........kolplook...',
    '.........kollllok...',
    '........kooooooook..',
    '.......koooddooook..',
    '.......kooooooooolk.',
    '.......koooooooollk.',
    '.kkk...kooooooollk..',
    'k...k..koooooollk...',
    'k....kkooooooolk....',
    '.k...kkolkolkkk.....',
    '..kkk..kk.kk........',
  ];

  const catSleep = [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '.......kkkkkk.......',
    '.....kkoooodokk.k.k.',
    '....koooooodooookpkpk',
    '...kooddooooooookoook',
    '..koooooooooooookkook',
    '..kooooooooooolkokkok',
    '..kooooooooollllooook',
    '...kkoooooolllllllk..',
    '.kkookkkkkkkkkkkkk...',
    '..kkk...............',
  ].map((r) => r.slice(0, 20));
  const catSleep2 = catSleep.slice();
  catSleep2[6] = '....................';
  catSleep2[7] = '.......kkkkkk...k.k.';

  // ---- dog ---------------------------------------------------------------
  const dogTop = [
    '....................',
    '.............kkkk...',
    '............kooookk.',
    '...........kdkoooook',
    '...k.......kdkoeoeok',
    '..kok......kdkoooook',
    '..kok......kdkoollnk',
    '...kok.kkkkkkkollllk',
    '....kkoooooooooolkk.',
    '.....kooooooooooook.',
    '.....kllooooooooook.',
    '......klllllllllkk..',
  ];
  const dogTop2 = dogTop.slice();
  dogTop2[3] = '..k........kdkoooook';
  dogTop2[4] = '.kok.......kdkoeoeok';
  dogTop2[5] = '.kok.......kdkoooook';
  dogTop2[6] = '..kok......kdkoollnk';

  const dogLegs = {
    stand: ['......kok.kok.kok.k.', '......kok.kok.kok.k.', '......kok.kok.kok.k.', '.....kkk.kkk.kkk.kk.'],
    walkA: catLegs.walkA,
    walkB: catLegs.walkB,
  };

  const dogSit = [
    '....................',
    '..........kkkk......',
    '.........kooookk....',
    '........kdkoooook...',
    '........kdkoeoeok...',
    '........kdkoooook...',
    '........kdkoollnk...',
    '.........kkollllk...',
    '........kooooookk...',
    '.......koooooooook..',
    '.......kooooooooolk.',
    '.kk....koooooooollk.',
    'kook...koooooollk...',
    '.kook.kooooooolk....',
    '..kokkkkolkolkkk....',
    '...kk..kk.kk........',
  ];

  const dogSleep = [
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '....................',
    '.......kkkkkkk......',
    '.....kkooooooookkkk.',
    '....kooooooooookoook',
    '...koooooooooookdook',
    '..kooooooooooookdkok',
    '..koooooooooolkkoolnk',
    '..kooooooooollllllk.',
    '...kkoooooolllllkk..',
    '.kkookkkkkkkkkkk....',
    '..kkk...............',
  ].map((r) => r.slice(0, 20));
  const dogSleep2 = dogSleep.slice();
  dogSleep2[6] = '....................';
  dogSleep2[7] = '.......kkkkkkkkkkkk.';

  const build = (top, top2, legs, sit, sleep, sleep2) => ({
    idle: [top.concat(legs.stand), top2.concat(legs.stand)],
    walk: [top.concat(legs.walkA), top2.concat(legs.walkB)],
    sit: [sit],
    sleep: [sleep, sleep2],
  });

  return {
    cat: {
      palette: { k: '#2b1d14', o: '#f0a052', d: '#c06a26', l: '#fde6c8', p: '#f08ca0', e: '#1d2b1a' },
      frames: build(catTop, catTop2, catLegs, catSit, catSleep, catSleep2),
    },
    dog: {
      palette: { k: '#2a1a10', o: '#c98d55', d: '#7a4a26', l: '#f6ead6', n: '#1a1010', e: '#1a1010' },
      frames: build(dogTop, dogTop2, dogLegs, dogSit, dogSleep, dogSleep2),
    },
  };
})();

if (typeof module !== 'undefined') module.exports = SPRITES;
