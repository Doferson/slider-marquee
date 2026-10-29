(() => {
  const SLIDES = [
    'assets/slide-01.png',
    'assets/slide-02.png',
    'assets/slide-03.png',
    'assets/slide-04.png',
    'assets/slide-05.png',
  ];

  const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUTO_SPEED = REDUCED_MOTION ? 0 : 0.15; // доля ширины карточки в секунду
  const EASE_RATE = 2.5; // скорость сглаживания скорости ленты (1/с)
  const PARALLAX = 0.08; // сдвиг картинки от положения на экране, доля ширины карточки
  const PARALLAX_VELOCITY = 0.035; // сдвиг от скорости ленты: px на 1 px/с
  const PARALLAX_VELOCITY_MAX = 0.12; // предел сдвига от скорости, доля ширины карточки
  const DRAG_THRESHOLD = 6;
  const PRESS_DELAY = 180; // через сколько мс удержания карточки начинают уменьшаться
  const REVEAL_STAGGER = 0.08;
  const MASK_DURATION = 750;
  const MASK_STAGGER = 90; // задержка на каждый шаг карточки от открытой
  const OPEN_DURATION = 750;
  const OPEN_EASING = 'cubic-bezier(0.76, 0, 0.24, 1)';
  const SWITCH_DURATION = 1200;
  const SWITCH_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const LABEL_DURATION = 650;
  const LABEL_EASING = 'cubic-bezier(0.45, 0, 0.2, 1)';
  const LABEL_IN_DELAY = 80; // новая подпись трогается чуть позже ухода старой
  const CURSOR_LABELS = {
    open: 'Открыть',
    close: 'Закрыть',
    prev: 'Предыдущее фото',
    next: 'Следующее фото',
  };
  // Открытый слайд в макете: 800×1040 при 1920×1080, отступ 20px
  const OPEN_RATIO = 800 / 1040;
  const CLOSE_HOME = { x: 849 / 1920, y: 342 / 1080 };

  const root = document.documentElement;
  const slider = document.querySelector('[data-slider]');
  const track = document.querySelector('[data-track]');
  const viewer = document.querySelector('[data-viewer]');
  const viewerNum = document.querySelector('[data-viewer-num]');
  const viewerMedia = document.querySelector('[data-viewer-media]');
  const cursorBtn = document.querySelector('[data-cursor]');
  let viewerImg = document.querySelector('[data-viewer-img]');

  const pad = (n) => String(n).padStart(2, '0') + '.';
  const mod = (a, n) => ((a % n) + n) % n;
  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  let items = [];
  let vw = 0;
  let slideW = 0;
  let slideH = 0;
  let step = 0;
  let total = 0;
  let padX = 0;

  let offset = 0;
  let lastOffset = 0;
  let velocity = 0;
  let velocityShift = 0;
  let autoplay = false;
  let revealed = false;

  const pointer = { x: -1, y: -1, mouse: false };
  const drag = { active: false, id: null, startX: 0, lastX: 0, lastT: 0, v: 0, moved: false };
  let hovered = null;
  let focusItem = null; // карточка в фокусе с клавиатуры: лента стоит и подтягивает её в кадр

  const view = { open: false, busy: false, item: null };
  const cursor = { x: 0, y: 0, tx: 0, ty: 0 };

  // ---------- Build ----------

  function createSlide(src, index, isClone) {
    const el = document.createElement('div');
    el.className = 'slide';
    el.innerHTML = `
      <p class="slide__num"><span>${pad(index + 1)}</span></p>
      <div class="slide__media">
        <div class="slide__parallax">
          <img class="slide__img" src="${src}" alt="" draggable="false">
        </div>
      </div>`;
    if (isClone) {
      el.setAttribute('aria-hidden', 'true');
    } else {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Открыть слайд ${pad(index + 1)}`);
    }
    return {
      el,
      src,
      index,
      label: pad(index + 1),
      media: el.querySelector('.slide__media'),
      parallax: el.querySelector('.slide__parallax'),
      img: el.querySelector('.slide__img'),
      num: el.querySelector('.slide__num span'),
      x: 0,
    };
  }

  function build() {
    const style = getComputedStyle(root);
    padX = parseFloat(style.getPropertyValue('--pad'));
    const gap = parseFloat(style.getPropertyValue('--gap'));
    vw = window.innerWidth;

    // Ширину карточки берём из CSS, чтобы не дублировать clamp()
    const probe = createSlide(SLIDES[0], 0, true);
    probe.el.style.visibility = 'hidden';
    track.append(probe.el);
    slideW = probe.el.offsetWidth;
    slideH = probe.el.offsetHeight;
    probe.el.remove();

    step = slideW + gap;
    // Хватает карточек, чтобы закрыть экран + одну за каждым краем
    const needed = Math.ceil(vw / step) + 2;
    const copies = Math.ceil(needed / SLIDES.length);
    const count = copies * SLIDES.length;

    if (count !== items.length) {
      const progress = total ? offset / total : 0;
      track.replaceChildren();
      items = [];
      for (let c = 0; c < copies; c++) {
        SLIDES.forEach((src, i) => {
          const item = createSlide(src, i, c > 0);
          if (revealed) item.el.classList.add('is-static');
          items.push(item);
          track.append(item.el);
        });
      }
      total = count * step;
      offset = progress * total;
    } else {
      const progress = total ? offset / total : 0;
      total = count * step;
      offset = progress * total;
    }

    lastOffset = offset;
    track.style.height = `${slideH}px`;
  }

  // ---------- Layout & render ----------

  function layout() {
    const center = vw / 2;
    const range = center + slideW;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const x = mod(i * step + offset + step, total) - step + padX;
      item.x = x;
      // translate, а не transform — чтобы scale при зажатии работал от центра карточки
      item.el.style.translate = `${x}px 0`;

      // Параллакс: картинка отстаёт от рамки по мере движения через экран
      // и дополнительно запаздывает тем сильнее, чем быстрее тянут ленту
      const p = clamp((x + slideW / 2 - center) / range, -1, 1);
      const shift = -p * slideW * PARALLAX + velocityShift;
      item.parallax.style.transform = `translate3d(${shift}px, 0, 0)`;
    }
  }

  function hitTest(clientX, clientY) {
    const rect = track.getBoundingClientRect();
    if (clientY < rect.top || clientY > rect.bottom) return null;
    return items.find((item) => clientX >= item.x && clientX < item.x + slideW) || null;
  }

  function setHovered(item) {
    if (item === hovered) return;
    hovered?.el.classList.remove('is-hover');
    hovered = item;
    hovered?.el.classList.add('is-hover');
  }

  let lastTime = performance.now();

  function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (!view.open && !drag.active && pointer.mouse) {
      setHovered(hitTest(pointer.x, pointer.y));
    }

    if (!drag.active) {
      const paused = !autoplay || hovered || focusItem || view.open;
      const target = paused ? 0 : -AUTO_SPEED * slideW;
      velocity += (target - velocity) * (1 - Math.exp(-dt * EASE_RATE));
      offset += velocity * dt;

      // Карточку, на которую перешли с клавиатуры, плавно подтягиваем в кадр
      if (focusItem) {
        const left = padX - focusItem.x;
        const right = vw - padX - (focusItem.x + slideW);
        const need = left > 0 ? left : Math.min(right, 0);
        offset += need * (1 - Math.exp(-dt * 8));
      }
    }

    // Фактическая скорость кадра — одинаково для драга, инерции и автоплея
    const frameVelocity = dt > 0 ? (offset - lastOffset) / dt : 0;
    const maxShift = slideW * PARALLAX_VELOCITY_MAX;
    const targetShift = clamp(-frameVelocity * PARALLAX_VELOCITY, -maxShift, maxShift);
    velocityShift += (targetShift - velocityShift) * (1 - Math.exp(-dt * 6));

    offset = mod(offset, total);
    lastOffset = offset;

    layout();

    // Круг-курсор следует за мышью с инерцией и подписывает зону под ней.
    // Позицию ведём всегда, даже когда круг скрыт, — появляется он сразу у курсора.
    const k = 1 - Math.exp(-dt * 12);
    cursor.x += (cursor.tx - cursor.x) * k;
    cursor.y += (cursor.ty - cursor.y) * k;
    // Именно translate, а не transform: scale применяется после transform
    // и сжал бы смещение к углу экрана, а translate — после scale
    cursorBtn.style.translate = `${cursor.x}px ${cursor.y}px`;

    if (view.open) {
      if (document.body.classList.contains('is-open')) {
        setCursorMode(pointer.mouse ? zoneAt(pointer.x, pointer.y) : 'close');
      }
    } else {
      // В ленте: OPEN над карточкой, пока её не тащат
      const visible = Boolean(hovered) && pointer.mouse && !(drag.active && drag.moved);
      cursorBtn.classList.toggle('is-visible', visible);
      slider.classList.toggle('is-cursor', visible);
      setCursorMode('open');
    }

    requestAnimationFrame(tick);
  }

  // ---------- Drag ----------

  // Короткий клик не должен трогать ленту: уменьшение карточек включается,
  // только если кнопку держат или ленту действительно потащили
  let pressTimer = 0;

  slider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || view.open || view.busy) return;
    drag.active = true;
    drag.id = e.pointerId;
    drag.startX = drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
    drag.v = 0;
    drag.moved = false;
    pressTimer = setTimeout(() => slider.classList.add('is-pressed'), PRESS_DELAY);
    if (cursorBtn.classList.contains('is-visible')) {
      cursorPressed = true;
      pressCursor(true);
    }
    slider.setPointerCapture(e.pointerId);
  });

  slider.addEventListener('pointermove', (e) => {
    if (!drag.active || e.pointerId !== drag.id) return;

    // До порога лента стоит: дрожь руки при клике не двигает карточки
    // и не даёт рывка параллакса от скорости
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.startX) <= DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.lastX = e.clientX;
      drag.lastT = e.timeStamp;
      velocity = 0;
      clearTimeout(pressTimer);
      slider.classList.add('is-dragging', 'is-pressed');
      return;
    }

    const dx = e.clientX - drag.lastX;
    const dt = Math.max(e.timeStamp - drag.lastT, 1);
    offset += dx;
    drag.v = drag.v * 0.6 + (dx / dt) * 1000 * 0.4;
    drag.lastX = e.clientX;
    drag.lastT = e.timeStamp;
  });

  function endDrag(e) {
    if (!drag.active || e.pointerId !== drag.id) return;
    drag.active = false;
    clearTimeout(pressTimer);
    slider.classList.remove('is-dragging', 'is-pressed');

    if (drag.moved) {
      // Инерция: если палец остановился перед отпусканием — без броска
      const idle = e.timeStamp - drag.lastT;
      velocity = idle > 80 ? 0 : clamp(drag.v, -5000, 5000);
    } else if (e.type === 'pointerup') {
      const item = hitTest(e.clientX, e.clientY);
      if (item) open(item);
    }
  }

  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);

  // ---------- Hover tracking ----------

  // Тач-ввод прячет круг-курсор; движение мышью возвращает его (ноутбук с тачскрином).
  // На телефонах (без hover) круга нет никогда.
  const noHover = window.matchMedia('(hover: none)');
  const setTouch = (on) => document.body.classList.toggle('is-touch', on || noHover.matches);
  setTouch(false);
  window.addEventListener('pointerdown', (e) => setTouch(e.pointerType !== 'mouse'), true);

  window.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.mouse = e.pointerType === 'mouse';
    if (pointer.mouse) setTouch(false);
    cursor.tx = e.clientX;
    cursor.ty = e.clientY;
  });

  document.documentElement.addEventListener('pointerleave', () => {
    pointer.mouse = false;
    setHovered(null);
  });

  // ---------- Open / close ----------

  function targetRect() {
    const vh = window.innerHeight;
    let h = vh - padX * 2;
    let w = h * OPEN_RATIO;
    if (w > vw - padX * 2) {
      w = vw - padX * 2;
      h = w / OPEN_RATIO;
    }
    return { left: vw - padX - w, top: vh - padX - h, width: w, height: h };
  }

  const toFrame = (r) => ({
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });

  function applyRect(r) {
    Object.assign(viewerMedia.style, toFrame(r));
  }

  // Геометрия картинки внутри карточки: шире на 20% и сдвинута параллаксом
  function slideImgFrame(item) {
    const shift = new DOMMatrixReadOnly(getComputedStyle(item.parallax).transform).m41;
    const scale = parseFloat(getComputedStyle(item.img).scale) || 1;
    return {
      left: '-20%',
      width: '140%',
      transform: `translateX(${shift}px) scale(${scale})`,
    };
  }

  const viewerImgFrame = { left: '0%', width: '100%', transform: 'translateX(0px) scale(1)' };

  // Маски карточек: hide — закрываются сверху вниз, иначе раскрываются снизу вверх,
  // зеркально анимации появления. Волна идёт от открытой карточки: при сворачивании
  // первыми уходят соседние, при раскрытии — сначала дальние, ближние последними.
  let maskAnims = [];

  function animateMasks(hide, active) {
    const prev = maskAnims;
    const slotsAway = (item) => Math.round(Math.abs(item.x - active.x) / step);
    const maxSlots = Math.max(
      1,
      ...items.filter((it) => it.x < vw && it.x + slideW > 0).map(slotsAway),
    );

    maskAnims = items.flatMap((item) => {
      const slots = Math.min(slotsAway(item), maxSlots);
      const order = hide ? Math.max(slots - 1, 0) : maxSlots - slots;
      const options = {
        duration: MASK_DURATION,
        easing: OPEN_EASING,
        delay: order * MASK_STAGGER,
        fill: 'forwards',
      };
      // Один кадр — старт от текущего значения, поэтому прерывание не дёргается
      const num = item.num.animate([{ transform: hide ? 'translateY(110%)' : 'translateY(0%)' }], options);
      // Картинку открытой карточки подменяет вьюер — её маску не трогаем
      if (item === active) return [num];
      return [
        num,
        item.media.animate([{ clipPath: hide ? 'inset(100% 0% 0% 0%)' : 'inset(0% 0% 0% 0%)' }], options),
        item.img.animate([{ transform: hide ? 'translateY(15%) scale(1.3)' : 'translateY(0%) scale(1)' }], options),
      ];
    });

    const current = maskAnims;
    Promise.all(current.map((a) => a.finished))
      .then(() => {
        prev.forEach((a) => a.cancel());
        // Раскрытые карточки возвращаем под управление CSS
        if (!hide && maskAnims === current) {
          current.forEach((a) => a.cancel());
          maskAnims = [];
        }
      })
      .catch(() => {});
  }

  function open(item) {
    if (view.open || view.busy) return;
    view.open = true;
    view.busy = true;
    view.item = item;
    velocity = 0;
    setHovered(null);

    const from = item.media.getBoundingClientRect();
    const to = targetRect();
    const imgFrom = slideImgFrame(item);

    viewerImg.src = item.src;
    viewerNum.textContent = item.label;
    viewer.setAttribute('aria-hidden', 'false');

    if (!pointer.mouse) {
      cursor.tx = vw * CLOSE_HOME.x;
      cursor.ty = window.innerHeight * CLOSE_HOME.y;
    }
    cursor.x = cursor.tx;
    cursor.y = cursor.ty;

    item.el.classList.add('is-active');
    document.body.classList.add('is-open');
    applyRect(to);
    animateMasks(true, item);

    viewerImg.animate([imgFrom, viewerImgFrame], {
      duration: OPEN_DURATION,
      easing: OPEN_EASING,
    });
    viewerMedia
      .animate([toFrame(from), toFrame(to)], { duration: OPEN_DURATION, easing: OPEN_EASING })
      .finished.then(() => {
        view.busy = false;
        cursorBtn.focus({ preventScroll: true });
      });
  }

  // ---------- Листание в открытом слайде ----------

  function zoneAt(x, y) {
    const r = viewerMedia.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return 'close';
    return x < r.left + r.width / 2 ? 'prev' : 'next';
  }

  const labelText = (mode) => cursorBtn.querySelector(`[data-label="${mode}"] span`);

  // Текущее положение текста в % от высоты строки (с учётом идущей анимации)
  function labelY(el) {
    const height = el.offsetHeight; // без учёта scale круга, как и m42
    const y = new DOMMatrixReadOnly(getComputedStyle(el).transform).m42;
    return height ? (y / height) * 100 : 0;
  }

  // Анимируем от текущего положения, чтобы быстрые смены зон не дёргались
  function slideLabel(el, from, to, delay = 0) {
    el.getAnimations().forEach((a) => a.cancel());
    el.animate([{ transform: `translateY(${from}%)` }, { transform: `translateY(${to}%)` }], {
      duration: LABEL_DURATION,
      easing: LABEL_EASING,
      delay,
      fill: 'backwards',
    });
  }

  function setCursorMode(mode) {
    const prev = cursorBtn.dataset.mode;
    if (prev === mode) return;
    const outEl = labelText(prev);
    const inEl = labelText(mode);
    // Положения читаем до смены data-mode: после неё CSS уже даёт конечные
    const outFrom = labelY(outEl);
    const inFrom = inEl.getAnimations().length ? labelY(inEl) : 110;

    cursorBtn.dataset.mode = mode;
    cursorBtn.setAttribute('aria-label', CURSOR_LABELS[mode]);
    // Не успевшая въехать подпись уходит обратно вниз, а не проезжает через круг
    slideLabel(outEl, outFrom, outFrom > 0 ? 110 : -110);
    slideLabel(inEl, inFrom, 0, inFrom === 110 ? LABEL_IN_DELAY : 0);
  }

  const instant = { duration: 0, fill: 'forwards' };

  // Лента под вьюером скрыта масками, поэтому карточку открытого фото меняем
  // незаметно: сдвигаем ленту так, чтобы новая карточка встала на место старой.
  // Тогда при закрытии фото улетает в правильную карточку.
  function swapActiveItem(index) {
    const prev = view.item;
    const next = items.find((it) => it.index === index);
    const delta = prev.x - next.x;
    offset += delta;
    lastOffset += delta;
    layout();

    maskAnims.push(
      prev.media.animate([{ clipPath: 'inset(100% 0% 0% 0%)' }], instant),
      prev.img.animate([{ transform: 'translateY(15%) scale(1.3)' }], instant),
      next.media.animate([{ clipPath: 'inset(0% 0% 0% 0%)' }], instant),
      next.img.animate([{ transform: 'translateY(0%) scale(1)' }], instant),
    );
    prev.el.classList.remove('is-active');
    next.el.classList.add('is-active');
    view.item = next;
    return next;
  }

  // Листание не блокируется: каждый клик сразу кладёт новый кадр поверх,
  // даже если предыдущий ещё въезжает. Нижние кадры убираются, когда верхний
  // раскрылся полностью.
  let switchToken = 0;
  let numToken = 0;

  // Номер листается по направлению: NEXT — уходит вверх, новый снизу;
  // PREV — уходит вниз, новый сверху. Повторный клик подхватывает номер
  // с текущего положения.
  function slideNumber(label, dir) {
    const token = ++numToken;
    const shift = dir > 0 ? 110 : -110;
    const from = labelY(viewerNum);
    viewerNum.getAnimations().forEach((a) => a.cancel());
    viewerNum
      .animate([{ transform: `translateY(${from}%)` }, { transform: `translateY(${-shift}%)` }], {
        duration: SWITCH_DURATION * 0.4,
        easing: 'cubic-bezier(0.5, 0, 0.75, 0)',
        fill: 'forwards',
      })
      .finished.then(() => {
        if (token !== numToken) return;
        viewerNum.textContent = label;
        viewerNum.getAnimations().forEach((a) => a.cancel());
        viewerNum.animate([{ transform: `translateY(${shift}%)` }, { transform: 'translateY(0%)' }], {
          duration: SWITCH_DURATION * 0.6,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
      })
      .catch(() => {});
  }

  async function show(dir) {
    if (!view.open || view.busy) return;
    const token = ++switchToken;

    const next = swapActiveItem(mod(view.item.index + dir, SLIDES.length));

    // Сначала декодируем новое фото, потом запускаем номер и фото вместе —
    // иначе тяжёлое декодирование задерживает старт и они расходятся
    const newFrame = viewerImg.parentElement.cloneNode(true);
    const newImg = newFrame.querySelector('.viewer__img');
    newImg.src = next.src;
    await newImg.decode().catch(() => {});
    // Пока декодировали, успели кликнуть ещё раз — покажем более свежее фото
    if (token !== switchToken || !view.open) return;

    slideNumber(next.label, dir);

    // Новый кадр раскрывается маской со стороны листания, фото текущего уезжает
    // в другую сторону. Кадры стоят на месте; двигаются только фото внутри них,
    // и масштаб всегда с запасом на сдвиг (scale ≥ 1 + 2·|сдвиг|), чтобы не было щелей.
    const outgoing = viewerImg;
    viewerMedia.append(newFrame);
    viewerImg = newImg;

    const options = { duration: SWITCH_DURATION, easing: SWITCH_EASING };
    // Один кадр — сдвиг идёт от текущего положения, даже если фото само ещё въезжало
    outgoing.animate([{ transform: `translateX(${-dir * 8}%) scale(1.16)` }], {
      ...options,
      fill: 'forwards',
    });
    newImg.animate(
      [
        { transform: `translateX(${dir * 12}%) scale(1.25)` },
        { transform: 'translateX(0%) scale(1)' },
      ],
      options,
    );
    await newFrame
      .animate(
        [
          { clipPath: dir > 0 ? 'inset(0% 0% 0% 100%)' : 'inset(0% 100% 0% 0%)' },
          { clipPath: 'inset(0% 0% 0% 0%)' },
        ],
        options,
      )
      .finished.catch(() => {});

    if (viewerImg === newImg) dropLowerFrames();
  }

  function dropLowerFrames() {
    const top = viewerImg.parentElement;
    viewerMedia.querySelectorAll('.viewer__frame').forEach((frame) => {
      if (frame !== top) frame.remove();
    });
  }

  // Закрытие посреди листания: доводим верхний кадр и номер до конца мгновенно
  function settleSwitch() {
    switchToken++;
    numToken++;
    dropLowerFrames();
    viewerImg.parentElement.getAnimations().forEach((a) => a.finish());
    viewerImg.getAnimations().forEach((a) => a.finish());
    viewerNum.getAnimations().forEach((a) => a.cancel());
    viewerNum.textContent = view.item.label;
  }

  function close() {
    if (!view.open || view.busy) return;
    const { item } = view;
    view.busy = true;
    settleSwitch();

    const from = viewerMedia.getBoundingClientRect();
    const to = item.media.getBoundingClientRect();
    const imgTo = slideImgFrame(item);

    viewer.classList.add('is-flying');
    document.body.classList.remove('is-open');
    applyRect(to);
    animateMasks(false, item);

    viewerImg.animate([viewerImgFrame, imgTo], {
      duration: OPEN_DURATION,
      easing: OPEN_EASING,
      fill: 'forwards',
    });
    viewerMedia
      .animate([toFrame(from), toFrame(to)], { duration: OPEN_DURATION, easing: OPEN_EASING })
      .finished.then(() => {
        item.el.classList.remove('is-active');
        viewer.classList.remove('is-flying');
        viewer.setAttribute('aria-hidden', 'true');
        viewerImg.getAnimations().forEach((a) => a.cancel());
        view.open = false;
        view.busy = false;
        view.item = null;
        if (!item.el.hasAttribute('aria-hidden')) item.el.focus({ preventScroll: true });
      });
  }

  // Нажатие на круг: сжимается под пальцем, на отпускании пружинит обратно
  // и отпускает мягкую волну. transform свободен: позиция — translate, появление — scale.
  let pressAnims = [];

  function pressCursor(down) {
    const prev = pressAnims;
    const anim = cursorBtn.animate(
      [{ transform: down ? 'scale(0.82)' : 'scale(1)' }],
      down
        ? { duration: 220, easing: 'cubic-bezier(0.33, 1, 0.68, 1)', fill: 'forwards' }
        : { duration: 700, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', fill: 'forwards' },
    );
    pressAnims = [...prev, anim];
    if (down) return;

    cursorBtn.animate(
      [
        { transform: 'scale(1)', opacity: 0.9 },
        { transform: 'scale(1.7)', opacity: 0 },
      ],
      { duration: 800, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::after' },
    );
    anim.finished
      .then(() => {
        if (pressAnims[pressAnims.length - 1] !== anim) return;
        pressAnims.forEach((a) => a.cancel());
        pressAnims = [];
      })
      .catch(() => {});
  }

  let cursorPressed = false;
  viewer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !view.open) return;
    cursorPressed = true;
    pressCursor(true);
  });
  window.addEventListener('pointerup', () => {
    if (!cursorPressed) return;
    cursorPressed = false;
    pressCursor(false);
  });
  window.addEventListener('pointercancel', () => {
    if (!cursorPressed) return;
    cursorPressed = false;
    pressCursor(false);
  });

  viewer.addEventListener('click', (e) => {
    const zone = zoneAt(e.clientX, e.clientY);
    if (zone === 'close') close();
    else show(zone === 'next' ? 1 : -1);
  });

  // Мышь проходит сквозь круг, так что сюда попадает только Enter/Space,
  // когда фокус на нём после открытия слайда
  cursorBtn.addEventListener('click', close);

  // Фокус от клика мышью ленту не останавливает — только навигация с клавиатуры
  track.addEventListener('focusin', (e) => {
    const item = items.find((it) => it.el === e.target);
    focusItem = item && e.target.matches(':focus-visible') ? item : null;
  });
  track.addEventListener('focusout', () => { focusItem = null; });
  slider.addEventListener('pointerdown', () => { focusItem = null; });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') show(1);
    if (e.key === 'ArrowLeft') show(-1);
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('slide')) {
      e.preventDefault();
      const item = items.find((it) => it.el === e.target);
      if (item) open(item);
    }
  });

  // ---------- Resize ----------

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      if (view.open || view.busy) {
        // Пересобирать DOM под открытым слайдом нельзя — только подгоняем размеры
        vw = window.innerWidth;
        if (!view.busy) applyRect(targetRect());
        return;
      }
      build();
    });
  });

  // ---------- Init ----------

  function preload(src) {
    const img = new Image();
    img.src = src;
    return img.decode().catch(() => {});
  }

  build();
  layout();
  requestAnimationFrame(tick);

  Promise.all(SLIDES.map(preload)).then(() => {
    // Стаггер по порядку на экране, слева направо
    const visible = items
      .filter((it) => it.x < vw)
      .sort((a, b) => a.x - b.x);
    items.forEach((it) => {
      const order = visible.indexOf(it);
      it.el.style.setProperty('--delay', `${(order < 0 ? visible.length : order) * REVEAL_STAGGER}s`);
    });
    document.body.classList.add('is-ready');
    revealed = true;
    setTimeout(() => (autoplay = true), REDUCED_MOTION ? 0 : 600);
  });
})();
