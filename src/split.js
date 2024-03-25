import { $ } from './svg_utils';

export default class Split {
    constructor(wrapper) {
        this.draw_split_bar(wrapper);
    }

    draw_split_bar(elem) {
        const $split_bar = document.createElement('div');
        $split_bar.classList.add('split-bar');

        let x = 0;

        const mouseDownHandler = function (e) {
            x = e.clientX;

            document.addEventListener('mousemove', mouseMoveHandler);
            document.addEventListener('mouseup', mouseUpHandler);
        };

        const mouseMoveHandler = function (e) {
            const $table = $split_bar.previousElementSibling;
            const $gantt = $split_bar.nextSibling;

            const dx = e.clientX - x;
            const left =
                (Math.max(
                    0,
                    Math.min($split_bar.offsetLeft + dx, elem.clientWidth)
                ) /
                    elem.clientWidth) *
                100;

            $.style($split_bar, { left: `${left}%` });
            $.style($table, { 'flex-basis': `${left}%` });
            $.style($gantt, { 'flex-basis': `${100 - left}%` });
            $.style($table, { 'overflow-x': 'hidden' });
            $.style($gantt, { 'overflow-x': 'hidden' });

            x = e.clientX;
        };

        const mouseUpHandler = function () {
            const $table = $split_bar.previousElementSibling;
            const $gantt = $split_bar.nextSibling;

            document.removeEventListener('mousemove', mouseMoveHandler);
            document.removeEventListener('mouseup', mouseUpHandler);

            $.style($table, { 'overflow-x': 'auto' });
            $.style($gantt, { 'overflow-x': 'auto' });
        };

        $split_bar.addEventListener('mousedown', mouseDownHandler);
        elem.prepend($split_bar);
    }
}
