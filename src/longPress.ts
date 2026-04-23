const LONG_PRESS_MS = 500;

/**
 * Attach long-press (touch-hold) gesture to an element.
 * Fires the callback with a synthetic MouseEvent positioned at the touch point.
 * Cancels if the finger moves > 10 px or lifts early.
 */
export function addLongPress(
    el: HTMLElement,
    onLongPress: (event: MouseEvent) => void,
): void {
    let timer: number | null = null;
    let startX = 0;
    let startY = 0;

    const clear = () => {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
    };

    el.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;

        timer = window.setTimeout(() => {
            timer = null;

            // Synthesize a MouseEvent at the touch point for menu positioning
            const synthetic = new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: touch.clientX,
                clientY: touch.clientY,
            });
            onLongPress(synthetic);
        }, LONG_PRESS_MS);
    }, { passive: false });

    el.addEventListener('touchmove', (e: TouchEvent) => {
        if (timer === null) return;
        const touch = e.touches[0];
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (dx * dx + dy * dy > 100) clear(); // 10px threshold
    });

    el.addEventListener('touchend', clear);
    el.addEventListener('touchcancel', clear);
}
