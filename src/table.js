import { $ } from './svg_utils';

export default class Table {
    dragStartY = 0;
    constructor(gantt, columns) {
        this.set_defaults(gantt, columns);
    }

    set_defaults(gantt, columns) {
        this.gantt = gantt;
        this.columns = columns;
    }

    draw_table_header() {
        const $thead = document.createElement('thead');
        const $tr = document.createElement('tr');

        this.columns.forEach((column) => {
            const $th = document.createElement('th');
            $th.textContent = column.title;

            $tr.appendChild($th);
        });

        $thead.appendChild($tr);
        $thead.classList.add('table-header');

        $.style($tr, 'height', this.gantt.options.header_height + 9 + 'px');

        return $thead;
    }

    get_parentNode(tag, target) {
        if (target.tagName === tag.toUpperCase()) return target;
        return this.get_parentNode(tag, target.parentNode);
    }

    draw_table_body(tasks) {
        this.tasks = this.gantt.setGroupPosition(tasks);

        const $tbody = document.createElement('tbody');
        $tbody.classList.add('table-body');

        this.make_table_row().forEach((row) => $tbody.append(row));

        $tbody.addEventListener('mousedown', (e) => {
            const $td = this.get_parentNode('td', e.target);

            $td.classList.contains('draggable-item') &&
                this.bind_draggable_event($tbody);
        });

        return $tbody;
    }

    isRowLine(id) {
        if (id <= 2) return false;
        const target = this.tasks.find((t) => t.id === `${id}`);

        return !target.groupPosition.includes('last');
    }

    make_table_row() {
        return this.tasks.map((task, index) => {
            const deps = task.level - 1;
            const $tr = document.createElement('tr');
            $tr.setAttribute('draggable', 'true');
            $tr.setAttribute('data-id', task.id);
            $.style($tr, {
                height:
                    this.gantt.options.bar_height +
                    this.gantt.options.padding +
                    'px',
            });

            if (deps === 1 && task.groupPosition.includes('last')) {
                $tr.classList.add('root-last');
            }

            this.columns.forEach((column) => {
                const $td = document.createElement('td');
                const { data, render } = column;

                if (data === 'drag') {
                    $td.innerHTML = `<i class="fa fa-sort"></i>`;
                    $td.className = 'draggable-item';
                    $tr.append($td);
                    return;
                }

                if (data === 'wbs') {
                    $td.className = data;
                }

                if (data === 'name' && task.level > 1) {
                    $td.setAttribute('rel', task.type);
                    $td.className = `work-name indent-${deps} indent-${deps}-${task.groupPosition[0]}`;

                    if (task.groupPosition[1]) {
                        $td.classList.add(
                            `indent-${deps}-${task.groupPosition[1]}`
                        );
                    }

                    if (task.type !== 'default') {
                        $td.classList.add(task.closed ? 'closed' : 'opened');
                    }

                    for (let i = 0; i < deps; i++) {
                        const $ins = document.createElement('ins');
                        $ins.textContent = '';

                        this.isRowLine(task.parentId) &&
                            $ins.classList.add('row-line');

                        if (deps === 1 || i === deps - 2) {
                            $ins.classList.add('marker');

                            deps > 1 && $ins.classList.add('row-line');

                            $td.append($ins);
                            break;
                        }

                        $td.append($ins);
                    }
                }

                if (render) {
                    const child_node = render(task[data], task);
                    $td.append(child_node);
                } else {
                    const text = document.createTextNode(task[data] ?? '');
                    $td.append(text);
                }

                $tr.append($td);
            });

            $tr.addEventListener('mousedown', (e) => {
                const $td = this.get_parentNode('td', e.target);

                if ($td.classList.contains('draggable-item')) {
                    $tr.addEventListener('dragstart', (e) => {
                        e.target.classList.add('dragging');
                    });

                    $tr.addEventListener('dragend', (e) => {
                        e.target.classList.remove('dragging');
                    });
                }
            });

            return $tr;
        });
    }

    get_drag_after_element(container, y) {
        const draggableElements = [
            ...container.querySelectorAll('tr:not(.dragging)'),
        ];

        return draggableElements.reduce(
            (closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) {
                    return { offset: offset, element: child };
                } else {
                    return closest;
                }
            },
            { offset: Number.NEGATIVE_INFINITY }
        ).element;
    }

    find_task_item(id) {
        return this.tasks.find((t) => t.id === id);
    }

    bind_draggable_event($tbody) {
        $tbody.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!this.dragStartY) this.dragStartY = e.clientY;

            this.draggableEl = document.querySelector('.dragging');
            this.afterElement = this.get_drag_after_element($tbody, e.clientY);

            $tbody.insertBefore(this.draggableEl, this.afterElement);
        });

        $tbody.addEventListener('drop', async (e) => {
            e.preventDefault();
            const targetItem = this.find_task_item(
                this.get_parentNode('tr', e.target).getAttribute('data-id')
            );
            const dragItem = this.find_task_item(
                this.draggableEl.getAttribute('data-id')
            );
            const afterItem = this.find_task_item(
                this.afterElement.getAttribute('data-id')
            );

            const params = {
                c_id: dragItem.id,
                ref: afterItem.parentId,
                c_position:
                    e.clientY > this.dragStartY
                        ? afterItem.position - 1
                        : afterItem.position,
                level: afterItem.level,
                p_position: dragItem.position,
                p_parentId: dragItem.parentId,
            };

            if (targetItem.type !== 'default') {
                const arr = this.tasks.filter(
                    (t) => t.parentId === Number(targetItem.id)
                ).length;
                params.ref = targetItem.id;
                params.level = targetItem.level + 1;
                params.c_position = arr ? arr : 0;
            }

            this.dragStartY = 0;
            this.gantt.draggble_rerender(params);
            this.gantt.trigger_event('drag_row', [params]);
        });
    }
}
