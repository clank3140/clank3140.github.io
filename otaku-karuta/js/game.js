document.addEventListener('DOMContentLoaded', () => {
  const TIMING = {
    questionCutDuration: 800,
    kamiCharInterval:    200,
    correctAdvanceDelay: 1200, // 札が消えるアニメ(0.6s)と正解トースト(source)を見せてから次の問題へ
    shakeDuration:       400,  // シェイクアニメ(0.38s)が終わるまで（固まり防止）
    penaltyMs:           3000,
    screenTransition:    180,
  };

  let allMemes    = [];
  let questions   = [];
  let results     = []; // #14 各問の { elapsed, penalties } を記録
  let currentIndex = 0;
  let totalTime   = 0;
  let penaltyTime = 0;
  let startTime   = 0;
  let kamiTimerId    = null;
  let advanceTimerId = null; // 正解後、次の問題へ進むまでの遅延タイマー
  let cutTimerId     = null; // 「第○問」カット → プレイ画面への遅延タイマー
  let shakeTimerId   = null; // 誤答シェイク後に状態を戻すタイマー
  let fadeTimerId    = null; // 画面フェードアウト遷移のタイマー
  let isProcessing = false;
  let rafId       = null;  // #11 ライブタイマー
  let lastRank    = null;  // #15 ツイート文言用に直近のランクを保持

  const titleScreen    = document.getElementById('title-screen');
  const questionCut    = document.getElementById('question-cut');
  const playScreen     = document.getElementById('play-screen');
  const resultScreen   = document.getElementById('result-screen');

  const allScreens = [titleScreen, questionCut, playScreen, resultScreen];

  const startNormalBtn     = document.getElementById('start-normal');
  const startExtremeBtn    = document.getElementById('start-extreme');
  const questionNumberText = document.getElementById('question-number-text');
  const cutSubText         = document.getElementById('cut-sub-text');
  const kamiText           = document.getElementById('kami-text');
  const fudaGrid           = document.getElementById('fuda-grid');
  const progressCells      = document.getElementById('progress-cells');
  const progressLabel      = document.getElementById('progress-label');
  const resultTime         = document.getElementById('result-time');
  const resultBreakdown    = document.getElementById('result-breakdown');
  const tweetBtn           = document.getElementById('tweet-btn');
  const retryBtn           = document.getElementById('retry-btn');
  const resultBackBtn      = document.getElementById('result-back-btn');
  const backToTitleBtn     = document.getElementById('back-to-title-btn');
  const themeSwitcher      = document.getElementById('theme-switcher');
  const correctToast       = document.getElementById('correct-toast');
  const toastSource        = document.getElementById('toast-source');
  const liveTimerEl        = document.getElementById('live-timer');
  const timerValue         = document.getElementById('timer-value');
  const penaltyPop         = document.getElementById('penalty-pop');
  const muteBtn            = document.getElementById('mute-btn');
  const rankLetter         = document.getElementById('rank-letter');
  const rankComment        = document.getElementById('rank-comment');
  const newRecordEl        = document.getElementById('new-record');
  const bestLine           = document.getElementById('best-line');
  const kamiDisplay        = document.getElementById('kami-display');
  const kamiAudio          = document.getElementById('kami-audio');
  const replayBtn          = document.getElementById('replay-btn');

  // #26 難易度モード（normal: 上の句を文字表示 / hard=EXTREME: 上の句を音声で出題）
  // モードは開始時に NORMAL / EXTREME ボタンで選択する
  const AUDIO_DIR = 'assets/audio';
  const AUDIO_EXT = 'wav'; // 音声を MP3 化した場合は 'mp3' に変更
  let   gameMode  = 'normal';

  // ベストタイムはモード別に保存（ハードはノーマルと別記録として扱う）
  function bestKey() {
    return gameMode === 'hard' ? 'memekarta_best_hard' : 'memekarta_best';
  }

  // ============================
  // #16 効果音（Web Audio API でプログラム生成・外部ファイル不要）
  // ============================
  const Sound = (() => {
    const MUTE_KEY = 'memekarta_muted';
    let ctx = null;
    let master = null;
    let muted = localStorage.getItem(MUTE_KEY) === '1';

    // AudioContext はユーザー操作内で初期化／再開する（自動再生ポリシー対策）
    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.5;
        master.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }

    // 単音（ゲインのアタック→ディケイ包絡線つき）
    function note(freq, at, dur, type, peak) {
      const t0 = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'triangle';
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak || 0.3, t0 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    // 周波数を滑らかに動かす音（誤答のブー音などに使用）
    function glide(from, to, at, dur, type, peak) {
      const t0 = ctx.currentTime + at;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sawtooth';
      osc.frequency.setValueAtTime(from, t0);
      osc.frequency.linearRampToValueAtTime(to, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak || 0.25, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    // ホワイトノイズによる短いドラムロール
    function roll() {
      const dur = 0.5;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 600;
      const g = ctx.createGain();
      const t0 = ctx.currentTime;
      const beats = 9;
      for (let i = 0; i < beats; i++) {
        const tt = t0 + (i / beats) * dur;
        const lvl = 0.06 + (i / beats) * 0.18; // だんだん盛り上がるロール
        g.gain.setValueAtTime(lvl * 0.4, tt);
        g.gain.linearRampToValueAtTime(lvl, tt + (dur / beats) * 0.5);
      }
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter).connect(g).connect(master);
      src.start(t0);
      src.stop(t0 + dur);
      note(196, dur, 0.18, 'triangle', 0.35); // 最後の一打（G3）
    }

    const SFX = {
      // 正解: 明るい上昇音（ピロリン）
      correct() {
        note(523.25, 0,    0.14, 'triangle', 0.30); // C5
        note(659.25, 0.07, 0.14, 'triangle', 0.30); // E5
        note(783.99, 0.14, 0.22, 'triangle', 0.32); // G5
      },
      // 誤答: 低いブー音
      wrong() {
        glide(160, 80, 0,    0.32, 'sawtooth', 0.22);
        glide(150, 70, 0.02, 0.32, 'square',   0.12);
      },
      // ゲーム開始: ドラムロール
      start() {
        roll();
      },
      // 全問クリア: ファンファーレ
      complete() {
        note(523.25, 0,    0.16, 'triangle', 0.30); // C5
        note(659.25, 0.13, 0.16, 'triangle', 0.30); // E5
        note(783.99, 0.26, 0.16, 'triangle', 0.30); // G5
        note(1046.5, 0.39, 0.50, 'triangle', 0.34); // C6
      },
      // 新記録: より派手なファンファーレ（トリル付き）
      record() {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.1, 0.16, 'triangle', 0.30));
        note(1046.5, 0.40, 0.10, 'square',   0.26);
        note(1318.5, 0.50, 0.10, 'square',   0.26);
        note(1046.5, 0.60, 0.10, 'square',   0.26);
        note(1318.5, 0.70, 0.60, 'triangle', 0.34);
      },
    };

    return {
      play(name) {
        if (muted) return;
        if (!ensure()) return;
        try { if (SFX[name]) SFX[name](); } catch (e) { /* オーディオエラーは無視 */ }
      },
      unlock() { ensure(); },
      isMuted() { return muted; },
      setMuted(m) {
        muted = m;
        localStorage.setItem(MUTE_KEY, m ? '1' : '0');
      },
    };
  })();

  function updateMuteBtn() {
    const m = Sound.isMuted();
    muteBtn.textContent = m ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', m);
    muteBtn.setAttribute('aria-pressed', String(m));
  }
  updateMuteBtn();
  muteBtn.addEventListener('click', () => {
    Sound.setMuted(!Sound.isMuted());
    if (!Sound.isMuted()) Sound.unlock(); // ミュート解除時に AudioContext を準備
    updateMuteBtn();
  });

  // ============================
  // #15 ランク評価
  // ============================
  // getRank() は maxSec 昇順に find するため、必ず小さい順に並べること
  const RANKS = [
    { rank: 'SSSS', maxSec: 15,       comment: 'パーフェクトコミュニケーション（よし、楽しく話せたな！）' },
    { rank: 'SSS',  maxSec: 20,       comment: 'おそろしく速い回答　オレでなきゃ見逃しちゃうね' },
    { rank: 'SS',   maxSec: 30,       comment: 'ネ申' },
    { rank: 'S',    maxSec: 40,       comment: 'インターネット老人' },
    { rank: 'A',    maxSec: 50,       comment: 'ツイ廃' },
    { rank: 'B',    maxSec: 60,       comment: '新参' },
    { rank: 'C',    maxSec: 90,       comment: 'ニワカ' },
    { rank: 'D',    maxSec: Infinity, comment: '社会適合者' },
  ];
  function getRank(ms) {
    const sec = ms / 1000;
    return RANKS.find(r => sec <= r.maxSec) || RANKS[RANKS.length - 1];
  }
  function getBest() {
    const v = parseFloat(localStorage.getItem(bestKey()));
    return Number.isFinite(v) ? v : null;
  }

  // ============================
  // #11 ライブタイマー
  // ============================
  function renderTimer(ms) {
    timerValue.textContent = formatTime(ms);
  }
  function startLiveTimer() {
    cancelLiveTimer();
    const tick = () => {
      // 全問通しの累計タイム（経過 + ペナルティ）をリアルタイム表示
      renderTimer(totalTime + penaltyTime + (Date.now() - startTime));
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  }
  function cancelLiveTimer() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  function flashPenalty() {
    liveTimerEl.classList.remove('penalty-flash');
    void liveTimerEl.offsetWidth; // アニメーションを確実に再発火
    liveTimerEl.classList.add('penalty-flash');
    setTimeout(() => liveTimerEl.classList.remove('penalty-flash'), 350);
    penaltyPop.classList.remove('show');
    void penaltyPop.offsetWidth;
    penaltyPop.classList.add('show');
  }

  // データは index.html の <script src="data/memes.js"> で window.KARUTA_MEMES に読み込まれる
  // （fetch を使わないので file:// で直接開いても動作する）
  allMemes = Array.isArray(window.KARUTA_MEMES) ? window.KARUTA_MEMES : [];
  if (allMemes.length === 0) {
    console.error('ミームデータが読み込めませんでした（data/memes.js を確認してください）');
  }

  // 開始ボタン: NORMAL=文字表示 / EXTREME=音声出題
  startNormalBtn.addEventListener('click',  () => { gameMode = 'normal'; startGame(); });
  startExtremeBtn.addEventListener('click', () => { gameMode = 'hard';   startGame(); });
  retryBtn.addEventListener('click', startGame); // 直前のモードのまま再挑戦
  resultBackBtn.addEventListener('click', () => showScreen(titleScreen));
  backToTitleBtn.addEventListener('click', () => {
    // 自動進行中（正解後の遅延や「第○問」カット中）に戻ると、保留中の
    // タイマーが後から発火して画面を上書きし進行不能になるため、ここで全て止める
    clearGameTimers();
    isProcessing = false;
    correctToast.classList.remove('active');
    showScreen(titleScreen);
  });

  tweetBtn.addEventListener('click', () => {
    const formattedTime = formatTime(totalTime);
    const modeName = gameMode === 'hard' ? 'EXTREME' : 'NORMAL';
    const rankPart = lastRank ? ' ランク' + lastRank.rank + '「' + lastRank.comment + '」' : '';
    const tweetText = '【' + modeName + 'モード】\nミームかるたで10問を' + formattedTime + '秒でクリア！\n' + rankPart + '\n#ミームかるた';
    const url = 'https://x.com/intent/tweet'
      + '?text=' + encodeURIComponent(tweetText)
      + '&url=' + encodeURIComponent(window.location.href);
    window.open(url, '_blank');
  });

  // ============================
  // #22 テーマ切り替え
  // ============================
  function applyTheme(theme) {
    document.body.dataset.theme = theme;
    themeSwitcher.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });
  }

  const savedTheme = localStorage.getItem('memekarta_theme') || 'cyber';
  applyTheme(savedTheme);

  themeSwitcher.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      localStorage.setItem('memekarta_theme', btn.dataset.theme);
    });
  });

  // 上の句の読み上げ音声を再生（EXTREMEモード）。効果音ミュートとは独立して鳴らす
  function playKamiAudio() {
    if (!kamiAudio) return;
    kamiAudio.src = AUDIO_DIR + '/' + questions[currentIndex].id + '.' + AUDIO_EXT;
    kamiAudio.currentTime = 0;
    const p = kamiAudio.play();
    if (p && p.catch) p.catch(() => { /* 自動再生がブロックされたらリプレイボタンで再生 */ });
  }
  // 音声ファイルが無い／読み込めない場合は上の句テキストを表示して回答可能にする
  if (kamiAudio) {
    kamiAudio.addEventListener('error', () => {
      if (gameMode !== 'hard') return;
      kamiDisplay.classList.remove('audio-mode');
      kamiText.textContent = questions[currentIndex] ? questions[currentIndex].kami : '';
    });
  }
  if (replayBtn) {
    replayBtn.addEventListener('click', () => { Sound.unlock(); playKamiAudio(); });
  }

  // ============================
  // #21 タイトル背景カード
  // ============================
  (function initTitleBgCards() {
    const specs = [
      { w: 80,  h: 120, top: '8%',  side: 'left:4%',   rot: '-18deg', dur: '6s',   delay: '0s'   },
      { w: 60,  h: 90,  top: '12%', side: 'right:5%',  rot: '14deg',  dur: '7s',   delay: '1.2s' },
      { w: 70,  h: 105, top: '60%', side: 'left:2%',   rot: '-9deg',  dur: '5.5s', delay: '0.6s' },
      { w: 55,  h: 82,  top: '68%', side: 'right:3%',  rot: '21deg',  dur: '8s',   delay: '2s'   },
    ];
    specs.forEach(c => {
      const el = document.createElement('div');
      el.className = 'title-bg-card';
      el.style.cssText = `width:${c.w}px;height:${c.h}px;top:${c.top};${c.side};--rot:${c.rot};--dur:${c.dur};animation-delay:${c.delay};`;
      titleScreen.appendChild(el);
    });
  })();

  // ============================
  // #12 プログレスバー
  // ============================
  function initProgressCells() {
    progressCells.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const cell = document.createElement('span');
      cell.className = 'p-cell';
      progressCells.appendChild(cell);
    }
  }

  function updateProgress(completedCount) {
    progressCells.querySelectorAll('.p-cell').forEach((cell, i) => {
      cell.classList.toggle('filled', i < completedCount);
    });
    progressLabel.textContent = (completedCount + 1) + ' / 10';
  }

  // ============================
  // ゲーム開始
  // ============================
  function startGame() {
    clearGameTimers();
    Sound.unlock();      // ユーザー操作内で AudioContext を起動
    Sound.play('start'); // #16 開始音（ドラムロール）
    const shuffled = shuffleArray([...allMemes]);
    questions    = shuffled.slice(0, 10);
    results      = [];
    totalTime    = 0;
    penaltyTime  = 0;
    currentIndex = 0;
    renderTimer(0);
    initProgressCells();
    showQuestion();
  }

  // ============================
  // 問題表示
  // ============================
  function showQuestion() {
    isProcessing = false;
    questionNumberText.textContent = '第' + (currentIndex + 1) + '問';
    if (cutSubText) {
      cutSubText.textContent = currentIndex > 0
        ? '累計 ' + formatTime(totalTime) + ' 秒'
        : '準備はいい？';
    }
    showScreen(questionCut);

    cutTimerId = setTimeout(() => {
      cutTimerId = null;
      setupPlayScreen();
      showScreen(playScreen);
      startTime = Date.now();
      animateKami();
      startLiveTimer();
    }, TIMING.questionCutDuration);
  }

  // ============================
  // プレイ画面のセットアップ
  // ============================
  function setupPlayScreen() {
    const correctMeme = questions[currentIndex];
    const others   = allMemes.filter(m => m.id !== correctMeme.id);
    const dummies  = shuffleArray([...others]).slice(0, 8);
    const fudaList = shuffleArray([correctMeme, ...dummies]);

    updateProgress(currentIndex);
    kamiText.textContent = '';

    fudaGrid.innerHTML = '';
    fudaList.forEach((meme, index) => {
      const div = document.createElement('div');
      // #10: staggered flip-in per card
      div.classList.add('fuda', 'flip-in');
      div.style.animationDelay = (index * 40) + 'ms';
      div.setAttribute('data-id', meme.id);
      div.textContent = meme.shimo;
      div.addEventListener('click', handleFudaTap);
      // flip-in 完了後はクラスと delay を除去（fly-away / shake と競合させないため）
      div.addEventListener('animationend', () => {
        div.classList.remove('flip-in');
        div.style.animationDelay = '';
      }, { once: true });
      fudaGrid.appendChild(div);
    });
  }

  // ============================
  // 上の句アニメーション
  // ============================
  function animateKami() {
    const kami = questions[currentIndex].kami;
    kamiText.textContent = '';

    // ハードモード: 上の句テキストは隠し、音声で出題する
    if (gameMode === 'hard') {
      kamiDisplay.classList.add('audio-mode');
      playKamiAudio();
      return;
    }
    kamiDisplay.classList.remove('audio-mode');

    let charIndex = 0;
    kamiTimerId = setInterval(() => {
      if (charIndex < kami.length) {
        kamiText.textContent += kami[charIndex];
        charIndex++;
      } else {
        clearInterval(kamiTimerId);
        kamiTimerId = null;
      }
    }, TIMING.kamiCharInterval);
  }

  function clearKamiTimer() {
    if (kamiTimerId !== null) {
      clearInterval(kamiTimerId);
      kamiTimerId = null;
    }
  }

  // 進行を駆動している保留中タイマーを全て停止する（タイトルへ戻る／再スタート時）
  function clearGameTimers() {
    clearKamiTimer();
    cancelLiveTimer();
    if (kamiAudio) kamiAudio.pause();
    if (advanceTimerId !== null) { clearTimeout(advanceTimerId); advanceTimerId = null; }
    if (cutTimerId     !== null) { clearTimeout(cutTimerId);     cutTimerId     = null; }
    if (shakeTimerId   !== null) { clearTimeout(shakeTimerId);   shakeTimerId   = null; }
  }

  // ============================
  // 札タップ処理
  // ============================
  function handleFudaTap(e) {
    if (isProcessing) return;

    const tappedFuda = e.currentTarget;
    if (tappedFuda.classList.contains('wrong') || tappedFuda.classList.contains('fly-away')) return;

    const tappedId  = Number(tappedFuda.getAttribute('data-id'));
    const correctId = questions[currentIndex].id;

    // flip-in が残っていると fly-away / shake より CSS ソース順で優先され、
    // アニメーションが発火しない（= 進行が固まる）ため、ここで確実に除去する
    tappedFuda.classList.remove('flip-in');
    tappedFuda.style.animationDelay = '';

    if (tappedId === correctId) {
      isProcessing = true;

      const elapsed = Date.now() - startTime;
      // #14 この問の結果と出題内容を記録（penaltyTime は問ごとにリセットされる）
      results.push({
        elapsed,
        penalties: Math.round(penaltyTime / TIMING.penaltyMs),
        meme: questions[currentIndex],
      });
      totalTime  += elapsed + penaltyTime;
      penaltyTime = 0;

      clearKamiTimer();
      cancelLiveTimer();
      renderTimer(totalTime); // 確定した累計タイムで停止
      Sound.play('correct');  // #16 正解音
      // ハードモードでは正解時に上の句テキストを開示し、読み上げを止める
      if (gameMode === 'hard') {
        kamiDisplay.classList.remove('audio-mode');
        if (kamiAudio) kamiAudio.pause();
      }
      kamiText.textContent = questions[currentIndex].kami;

      // #8: 拡大フェードアウトアニメーション（ランダムな斜め方向）— 全画面オーバーレイは出さず、札が消えるのを見せる
      const dir = Math.random() > 0.5 ? 1 : -1;
      tappedFuda.style.setProperty('--fly-rot', (dir * (10 + Math.random() * 12)) + 'deg');
      tappedFuda.style.setProperty('--fly-x',   (dir * (30 + Math.random() * 40)) + 'px');
      tappedFuda.classList.add('fly-away');

      // 正解トースト: 「正解！」+ 出典を表示
      toastSource.textContent = '出典: ' + questions[currentIndex].source;
      correctToast.classList.add('active');

      advanceTimerId = setTimeout(() => {
        advanceTimerId = null;
        correctToast.classList.remove('active');
        currentIndex++;
        if (currentIndex >= 10) {
          showResult();
        } else {
          showQuestion();
        }
      }, TIMING.correctAdvanceDelay);

    } else {
      isProcessing = true;

      penaltyTime += TIMING.penaltyMs;
      flashPenalty();        // #11 タイマーを赤フラッシュ + 「+3秒」ポップ
      Sound.play('wrong');   // #16 誤答音

      // #9: シェイクアニメーション → wrong状態に移行（全画面オーバーレイは出さず、札の揺れを見せる）
      tappedFuda.classList.add('shake');

      // animationend に頼らず setTimeout で確実に状態を戻す（固まり防止）
      shakeTimerId = setTimeout(() => {
        shakeTimerId = null;
        tappedFuda.classList.remove('shake');
        tappedFuda.classList.add('wrong');
        isProcessing = false;
      }, TIMING.shakeDuration);
    }
  }

  // ============================
  // 結果画面
  // ============================
  function showResult() {
    cancelLiveTimer();
    const finalMs = totalTime;
    resultTime.textContent = formatTime(finalMs);

    // #15 ランク・評価コメント
    const r = getRank(finalMs);
    lastRank = r;
    rankLetter.textContent = r.rank;
    rankComment.textContent = '「' + r.comment + '」';

    // #15/#16 ベストタイム更新と新記録判定
    const best = getBest();
    const isRecord = best === null || finalMs < best;
    if (isRecord) {
      localStorage.setItem(bestKey(), String(finalMs));
      newRecordEl.classList.add('show');
      bestLine.textContent = 'ベスト: ' + formatTime(finalMs) + ' 秒';
    } else {
      newRecordEl.classList.remove('show');
      bestLine.textContent = 'ベスト: ' + formatTime(best) + ' 秒';
    }

    renderBreakdown(); // #14 問題ごとの正誤・タイム一覧

    showScreen(resultScreen);
    Sound.play(isRecord ? 'record' : 'complete'); // #16 完了音 / 新記録音
  }

  // ============================
  // #14 問題ごとの結果一覧
  // ============================
  function renderBreakdown() {
    resultBreakdown.innerHTML = '';
    if (results.length === 0) return;

    // 最速・最遅の問（解答時間 elapsed 基準）
    let fastestIdx = 0;
    let slowestIdx = 0;
    results.forEach((r, i) => {
      if (r.elapsed < results[fastestIdx].elapsed) fastestIdx = i;
      if (r.elapsed > results[slowestIdx].elapsed) slowestIdx = i;
    });
    // 全問同タイム等で最速＝最遅になる場合はハイライトしない
    const showExtremes = fastestIdx !== slowestIdx;

    // ラベル付きの明細行を作る（上の句／下の句／元ネタ）
    const detailLine = (key, value) => {
      const line = document.createElement('div');
      line.className = 'rb-line';
      const k = document.createElement('span');
      k.className = 'rb-key';
      k.textContent = key;
      const v = document.createElement('span');
      v.className = 'rb-val';
      v.textContent = value;
      line.append(k, v);
      return line;
    };

    results.forEach((r, i) => {
      const hasWrong = r.penalties > 0;
      const meme = r.meme || {};
      const row = document.createElement('div');
      row.className = 'rb-row ' + (hasWrong ? 'wrong' : 'correct');
      if (showExtremes && i === fastestIdx) row.classList.add('fastest');
      if (showExtremes && i === slowestIdx) row.classList.add('slowest');

      // ヘッダー行: 第n問 / 正誤 / タイム / ペナルティ / 最速・最遅
      const head = document.createElement('div');
      head.className = 'rb-head';

      const q = document.createElement('span');
      q.className = 'rb-q';
      q.textContent = '第' + (i + 1) + '問';

      const mark = document.createElement('span');
      mark.className = 'rb-mark';
      mark.textContent = hasWrong ? '✗' : '✓';

      const time = document.createElement('span');
      time.className = 'rb-time';
      time.textContent = formatTime(r.elapsed) + '秒';

      const pen = document.createElement('span');
      pen.className = 'rb-penalty';
      pen.textContent = hasWrong ? '（+3秒ペナルティ×' + r.penalties + '）' : '';

      const badge = document.createElement('span');
      badge.className = 'rb-badge';
      if (showExtremes && i === fastestIdx) badge.textContent = '最速';
      else if (showExtremes && i === slowestIdx) badge.textContent = '最遅';

      head.append(q, mark, time, pen, badge);

      // 明細: その問の出題内容
      const detail = document.createElement('div');
      detail.className = 'rb-detail';
      detail.append(
        detailLine('上の句', meme.kami),
        detailLine('下の句', meme.shimo),
        detailLine('元ネタ', meme.source),
      );

      row.append(head, detail);
      resultBreakdown.appendChild(row);
    });
  }

  // ============================
  // ユーティリティ
  // ============================
  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // #24: フェードアウト付き画面遷移
  function showScreen(target) {
    // 前の遷移が保留中なら破棄する。完了時は全画面の状態をクリアしてから
    // target だけを active にするため、遷移が重なっても二重 active にならない
    if (fadeTimerId !== null) {
      clearTimeout(fadeTimerId);
      fadeTimerId = null;
    }
    const current = allScreens.find(s => s.classList.contains('active'));
    if (current && current !== target) {
      current.classList.add('fade-out');
      fadeTimerId = setTimeout(() => {
        fadeTimerId = null;
        allScreens.forEach(el => el.classList.remove('active', 'fade-out'));
        target.classList.add('active');
      }, TIMING.screenTransition);
    } else {
      allScreens.forEach(el => el.classList.remove('active', 'fade-out'));
      target.classList.add('active');
    }
  }

  function formatTime(ms) {
    return (ms / 1000).toFixed(2);
  }
});
