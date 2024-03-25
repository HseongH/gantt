import date_utils from './date_utils';
import { $, createSVG } from './svg_utils';
import Bar from './bar';
import Arrow from './arrow';
import Popup from './popup';
import Table from './table';
import Split from './split';

import './gantt.scss';

const VIEW_MODE = {
    QUARTER_DAY: 'Quarter Day',
    HALF_DAY: 'Half Day',
    DAY: 'Day',
    WEEK: 'Week',
    MONTH: 'Month',
    YEAR: 'Year',
};

export default class Gantt {
    constructor(wrapper, tasks, options, contents) {
        this.originTasks = tasks;

        this.setup_options(options);
        this.setup_tasks(tasks);

        this.setup_wrapper(wrapper);

        // initialize with default view mode
        this.change_view_mode();
        this.setup_split_bar();
        this.setup_table(contents);

        this.bind_events();
    }

    setup_wrapper(element) {
        let svg_element;
        let wrapper_element;

        // CSS Selector is passed
        if (typeof element === 'string') {
            element = document.querySelector(element);
        }

        // get the SVGElement
        if (element instanceof HTMLElement) {
            wrapper_element = element;
            svg_element = element.querySelector('svg');
        } else if (element instanceof SVGElement) {
            svg_element = element;
        } else {
            throw new TypeError(
                'Frappé Gantt only supports usage of a string CSS selector,' +
                    " HTML DOM element or SVG DOM element for the 'element' parameter"
            );
        }

        // svg element
        if (!svg_element) {
            // create it
            this.$svg = createSVG('svg', {
                append_to: wrapper_element,
                class: 'gantt',
            });
        } else {
            this.$svg = svg_element;
            this.$svg.classList.add('gantt');
        }

        this.$wrapper = document.createElement('div');
        this.$wrapper.classList.add('wrapper');

        // wrapper element
        this.$container = document.createElement('div');
        this.$container.classList.add('gantt-container');

        const parent_element = this.$svg.parentElement;
        element.appendChild(this.setup_mode_handler());
        parent_element.appendChild(this.$wrapper);
        this.$wrapper.appendChild(this.$container);
        this.$container.appendChild(this.$svg);

        // popup wrapper
        this.popup_wrapper = document.createElement('div');
        this.popup_wrapper.classList.add('popup-wrapper');
        this.$container.appendChild(this.popup_wrapper);
    }

    setup_mode_handler() {
        const wrapper = document.createElement('div');
        const excel_export = document.createElement('button');
        const btn_group = document.createElement('div');

        wrapper.className = 'mt well well-sm clearfix';
        excel_export.className = 'btn btn-default btn-sm mr-xs';

        excel_export.innerText = 'Excel';

        $.style(btn_group, { float: 'right' });

        Object.keys(VIEW_MODE).forEach((key) => {
            const btn = document.createElement('button');
            btn.className = `btn btn-default btn-sm mr-xs ${
                VIEW_MODE[key] === this.options.view_mode ? 'active' : ''
            }`;
            btn.innerText = VIEW_MODE[key];
            btn.addEventListener('click', (e) => {
                e.target.classList.add('active');
                e.target.parentNode.childNodes.forEach((b) =>
                    b.classList.remove('active')
                );

                this.change_view_mode(VIEW_MODE[key]);
            });

            btn_group.appendChild(btn);
        });

        wrapper.append(excel_export);
        wrapper.append(btn_group);

        return wrapper;
    }

    setup_options(options) {
        const default_options = {
            header_height: 50,
            column_width: 30,
            step: 24,
            view_modes: [...Object.values(VIEW_MODE)],
            bar_height: 20,
            bar_corner_radius: 3,
            arrow_curve: 5,
            padding: 18,
            view_mode: 'Day',
            date_format: 'YYYY-MM-DD',
            popup_trigger: 'click',
            custom_popup_html: null,
            language: 'ko',
        };
        this.options = Object.assign({}, default_options, options);
    }

    setup_tasks(tasks) {
        // prepare tasks
        this.tasks = this.sort_tasks(tasks).map((task, i) => {
            // convert to Date objects
            task._start = date_utils.parse(task.start);
            task._end = date_utils.parse(task.end);

            // make task invalid if duration too large
            if (date_utils.diff(task._end, task._start, 'year') > 10) {
                task.end = null;
            }

            // cache index
            task._index = i;

            // invalid dates
            if (!task.start && !task.end) {
                const today = date_utils.today();
                task._start = today;
                task._end = date_utils.add(today, 2, 'day');
            }

            if (!task.start && task.end) {
                task._start = date_utils.add(task._end, -2, 'day');
            }

            if (task.start && !task.end) {
                task._end = date_utils.add(task._start, 2, 'day');
            }

            // if hours is not set, assume the last day is full day
            // e.g: 2018-09-09 becomes 2018-09-09 23:59:59
            const task_end_values = date_utils.get_date_values(task._end);
            if (task_end_values.slice(3).every((d) => d === 0)) {
                task._end = date_utils.add(task._end, 24, 'hour');
            }

            // invalid flag
            if (!task.start || !task.end) {
                task.invalid = true;
            }

            // dependencies
            if (typeof task.dependencies === 'string' || !task.dependencies) {
                let deps = [];
                if (task.dependencies) {
                    deps = task.dependencies
                        .split(',')
                        .map((d) => d.trim())
                        .filter((d) => d);
                }
                task.dependencies = deps;
            }

            // uids
            if (!task.id) {
                task.id = generate_id(task);
            }

            return task;
        });

        this.setup_dependencies();
    }

    setup_dependencies() {
        this.dependency_map = {};
        for (let t of this.tasks) {
            for (let d of t.dependencies) {
                this.dependency_map[d] = this.dependency_map[d] || [];
                this.dependency_map[d].push(t.id);
            }
        }
    }

    refresh(tasks) {
        this.setup_tasks(tasks);
        this.change_view_mode();
        this.rerender_table();
        this.originTasks = tasks;
    }

    change_view_mode(mode = this.options.view_mode) {
        this.update_view_scale(mode);
        this.setup_dates();
        this.render();
        // fire viewmode_change event
        this.trigger_event('view_change', [mode]);
    }

    update_view_scale(view_mode) {
        this.options.view_mode = view_mode;

        if (view_mode === VIEW_MODE.DAY) {
            this.options.step = 24;
            this.options.column_width = 38;
        } else if (view_mode === VIEW_MODE.HALF_DAY) {
            this.options.step = 24 / 2;
            this.options.column_width = 38;
        } else if (view_mode === VIEW_MODE.QUARTER_DAY) {
            this.options.step = 24 / 4;
            this.options.column_width = 38;
        } else if (view_mode === VIEW_MODE.WEEK) {
            this.options.step = 24 * 7;
            this.options.column_width = 140;
        } else if (view_mode === VIEW_MODE.MONTH) {
            this.options.step = 24 * 30;
            this.options.column_width = 120;
        } else if (view_mode === VIEW_MODE.YEAR) {
            this.options.step = 24 * 365;
            this.options.column_width = 120;
        }
    }

    setup_dates() {
        this.setup_gantt_dates();
        this.setup_date_values();
    }

    setup_gantt_dates() {
        this.gantt_start = this.gantt_end = null;

        for (let task of this.tasks) {
            // set global start and end date
            if (!this.gantt_start || task._start < this.gantt_start) {
                this.gantt_start = task._start;
            }
            if (!this.gantt_end || task._end > this.gantt_end) {
                this.gantt_end = task._end;
            }
        }

        this.gantt_start = date_utils.start_of(this.gantt_start, 'day');
        this.gantt_end = date_utils.start_of(this.gantt_end, 'day');

        // add date padding on both sides
        if (this.view_is([VIEW_MODE.QUARTER_DAY, VIEW_MODE.HALF_DAY])) {
            this.gantt_start = date_utils.add(this.gantt_start, -7, 'day');
            this.gantt_end = date_utils.add(this.gantt_end, 7, 'day');
        } else if (this.view_is(VIEW_MODE.MONTH)) {
            this.gantt_start = date_utils.start_of(this.gantt_start, 'year');
            this.gantt_end = date_utils.add(this.gantt_end, 1, 'year');
        } else if (this.view_is(VIEW_MODE.YEAR)) {
            this.gantt_start = date_utils.add(this.gantt_start, -2, 'year');
            this.gantt_end = date_utils.add(this.gantt_end, 2, 'year');
        } else {
            this.gantt_start = date_utils.add(this.gantt_start, -1, 'month');
            this.gantt_end = date_utils.add(this.gantt_end, 1, 'month');
        }
    }

    setup_date_values() {
        this.dates = [];
        let cur_date = null;

        while (cur_date === null || cur_date < this.gantt_end) {
            if (!cur_date) {
                cur_date = date_utils.clone(this.gantt_start);
            } else {
                if (this.view_is(VIEW_MODE.YEAR)) {
                    cur_date = date_utils.add(cur_date, 1, 'year');
                } else if (this.view_is(VIEW_MODE.MONTH)) {
                    cur_date = date_utils.add(cur_date, 1, 'month');
                } else {
                    cur_date = date_utils.add(
                        cur_date,
                        this.options.step,
                        'hour'
                    );
                }
            }
            this.dates.push(cur_date);
        }
    }

    bind_events() {
        this.bind_grid_click();
        this.bind_bar_events();
        this.bind_scroll_event();
    }

    render() {
        this.clear();
        this.setup_layers();
        this.make_grid();
        this.make_grid_header();
        this.make_dates();
        this.make_bars();
        this.make_arrows();
        this.map_arrows_on_bars();
        this.set_width();
        this.set_scroll_position();
    }

    rerender_table() {
        document.querySelector('.table-body')?.remove();

        const $table_body = this.table.draw_table_body(this.tasks, {
            height: this.options.bar_height + this.options.padding + 'px',
        });

        document
            .querySelector('.table-container table')
            .appendChild($table_body);

        $table_body.addEventListener('click', (event) =>
            this.bind_table_event(event)
        );
    }

    draggble_rerender(item) {
        this.update_origin_tasks(item);
        this.render();
        this.rerender_table();
    }

    sort_tasks(tasks) {
        const sorted_tasks = [...tasks];
        const children_idx_info = {};

        sorted_tasks
            .sort((a, b) => a.level - b.level || a.position - b.position)
            .forEach((task, taskIdx) => {
                if (task.parentId !== 2) {
                    if (children_idx_info.hasOwnProperty(task.parentId)) {
                        children_idx_info[task.parentId].push(taskIdx);
                    } else {
                        children_idx_info[task.parentId] = [taskIdx];
                    }

                    const parentIdx = sorted_tasks.findIndex(
                        (item) => +item.id === task.parentId
                    );

                    sorted_tasks.splice(taskIdx, 1);
                    sorted_tasks.splice(
                        parentIdx + children_idx_info[task.parentId].length,
                        0,
                        task
                    );
                }
            }, []);

        return sorted_tasks;
    }

    setGroupPosition(data) {
        return data.reduce((acc, cur) => {
            const group = data.filter((t) => t.parentId === cur.parentId);

            cur.groupPosition = [];

            if (group[0].id === cur.id) {
                cur.groupPosition.push('first');
            }
            if (group[group.length - 1].id === cur.id) {
                cur.groupPosition.push('last');
            }
            if (!cur.groupPosition.length) {
                cur.groupPosition.push('middle');
            }

            acc.push(cur);
            return acc;
        }, []);
    }

    update_dependecies(id) {
        if (id === 2) return [];

        const dependencies = this.tasks.find(
            (task) => task.id === id
        ).dependencies;

        if (!dependencies.length) return [id];
        return [...dependencies, id];
    }

    update_origin_tasks(item) {
        let tasks = this.tasks.reduce((acc, cur) => {
            if (cur.id === item.c_id) {
                const dependencies = this.update_dependecies(item.ref);

                cur = {
                    ...cur,
                    parentId: Number(item.ref),
                    dependencies,
                    position: item.c_position,
                    level: item.level,
                    wbs: dependencies.length
                        ? `${dependencies.join('-')}-${item.c_id}`
                        : `${item.c_id}`,
                };
            } else {
                if (
                    cur.parentId === Number(item.ref) &&
                    item.c_position === item.p_position
                ) {
                    acc.push(cur);
                    return acc;
                }

                if (cur.parentId === Number(item.ref)) {
                    cur.position =
                        item.c_position > item.p_position
                            ? cur.position < item.p_position
                                ? cur.position
                                : cur.position <= item.c_position
                                ? cur.position - 1
                                : cur.position
                            : cur.position > item.p_position
                            ? cur.position
                            : cur.position >= item.c_position
                            ? cur.position + 1
                            : cur.position;
                } else {
                    if (cur.parentId === item.p_parentId) {
                        cur.position =
                            cur.position < item.p_position
                                ? cur.position
                                : cur.position - 1;
                    }
                }
            }

            acc.push(cur);
            return acc;
        }, []);

        tasks = this.setGroupPosition(tasks);

        this.setup_tasks(tasks);
        this.originTasks = tasks;
    }

    setup_layers() {
        this.layers = {};
        const layers = [
            'grid',
            'arrow',
            'progress',
            'bar',
            'details',
            'header',
            'date',
        ];
        // make group layers
        for (let layer of layers) {
            this.layers[layer] = createSVG('g', {
                class: layer,
                append_to: this.$svg,
            });
        }
    }

    setup_split_bar() {
        this.split = new Split(this.$wrapper);
    }

    setup_table(contents, handler) {
        this.table = new Table(this, contents, handler);
        this.make_table();
    }

    bind_table_event(event) {
        const $tr = event.target.closest('tr');
        const id = $tr.dataset.id;

        if (
            event.target.tagName !== 'INS' &&
            !event.target.classList.contains('marker')
        ) {
            const task = this.get_task(id);

            this.handle_selected(task);

            return;
        }

        const $target = event.target.closest('td');

        if (
            $target.getAttribute('rel') === 'folder' ||
            $target.getAttribute('rel') === 'drive'
        ) {
            let tasks = [...this.tasks];

            if ($target.classList.contains('closed')) {
                this.originTasks.forEach((task) => {
                    if (task.id === id) {
                        delete task.closed;
                        return tasks.splice(task._index, 1, task);
                    }

                    if (task.dependencies.includes(id))
                        tasks.splice(task._index, 0, task);
                });
            } else {
                tasks = this.tasks.reduce((acc, task) => {
                    if (task.id === id) {
                        return [...acc, { ...task, closed: true }];
                    }

                    if (!task.dependencies.includes(id)) {
                        return [...acc, task];
                    }

                    return acc;
                }, []);
            }

            this.setup_tasks(tasks);
            this.render();
            this.rerender_table();
        }
    }

    make_table() {
        const $table_container = document.createElement('div');
        const $table = document.createElement('table');

        $table_container.className = 'table-container';

        const $table_header = this.table.draw_table_header();
        const $table_body = this.table.draw_table_body(this.tasks);

        $table.append($table_header);
        $table.append($table_body);

        $table_body.addEventListener('click', (event) =>
            this.bind_table_event(event)
        );

        $table_container.append($table);

        this.$wrapper.prepend($table_container);
    }

    make_grid() {
        this.make_grid_background();
        this.make_grid_rows();
        this.make_grid_ticks();
        this.make_grid_highlights();
    }

    handle_selected(task) {
        const $tr = this.$wrapper.querySelectorAll('tr')[task._index + 1];
        const $grid_row =
            this.$wrapper.querySelectorAll('.grid-row')[task._index];

        if (!$tr.classList.contains('selected')) {
            Array.prototype.forEach.call(
                this.$wrapper.querySelectorAll('.selected'),
                (elem) => elem.classList.remove('selected')
            );
        }

        $tr?.classList.toggle('selected');
        $grid_row?.classList.toggle('selected');
    }

    make_grid_background() {
        const grid_width = this.dates.length * this.options.column_width;
        const grid_height =
            this.options.header_height +
            this.options.padding +
            (this.options.bar_height + this.options.padding) *
                this.tasks.length;

        createSVG('rect', {
            x: 0,
            y: 0,
            width: grid_width,
            height: grid_height,
            class: 'grid-background',
            append_to: this.layers.grid,
        });

        $.attr(this.$svg, {
            height: grid_height,
            width: '100%',
        });
    }

    make_grid_rows() {
        const rows_layer = createSVG('g', { append_to: this.layers.grid });
        // const lines_layer = createSVG('g', { append_to: this.layers.grid });

        const row_width = this.dates.length * this.options.column_width;
        const row_height = this.options.bar_height + this.options.padding;

        let row_y = this.options.header_height + this.options.padding / 2;

        for (let task of this.tasks) {
            createSVG('rect', {
                x: 0,
                y: row_y,
                width: row_width,
                height: row_height,
                class: 'grid-row',
                append_to: rows_layer,
            });

            // createSVG('line', {
            //     x1: 0,
            //     y1: row_y + row_height,
            //     x2: row_width,
            //     y2: row_y + row_height,
            //     class: 'row-line',
            //     append_to: lines_layer,
            // });

            row_y += this.options.bar_height + this.options.padding;
        }
    }

    make_grid_header() {
        const header_width = this.dates.length * this.options.column_width;
        const header_height = this.options.header_height + 10;

        const pageScroll = window.scrollY;
        const originOffset =
            pageScroll + this.$wrapper.getBoundingClientRect().top;

        if (originOffset <= pageScroll) {
            this.layers.header.style.transform = `translate(0px, ${Math.floor(
                window.scrollY - originOffset
            )}px)`;
        }

        createSVG('rect', {
            x: 0,
            y: 0,
            width: header_width,
            height: header_height,
            class: 'grid-header',
            append_to: this.layers.header,
        });
    }

    make_grid_ticks() {
        let tick_x = 0;
        let tick_y = this.options.header_height + this.options.padding / 2;
        let tick_height =
            (this.options.bar_height + this.options.padding) *
            this.tasks.length;

        for (let date of this.dates) {
            let tick_class = 'tick';
            // thick tick for monday
            if (this.view_is(VIEW_MODE.DAY) && date.getDate() === 1) {
                tick_class += ' thick';
            }
            // thick tick for first week
            if (
                this.view_is(VIEW_MODE.WEEK) &&
                date.getDate() >= 1 &&
                date.getDate() < 8
            ) {
                tick_class += ' thick';
            }
            // thick ticks for quarters
            if (this.view_is(VIEW_MODE.MONTH) && date.getMonth() % 3 === 0) {
                tick_class += ' thick';
            }

            createSVG('path', {
                d: `M ${tick_x} ${tick_y} v ${tick_height}`,
                class: tick_class,
                append_to: this.layers.grid,
            });

            if (this.view_is(VIEW_MODE.MONTH)) {
                tick_x +=
                    (date_utils.get_days_in_month(date) *
                        this.options.column_width) /
                    30;
            } else {
                tick_x += this.options.column_width;
            }
        }
    }

    make_grid_highlights() {
        // highlight today's date
        if (this.view_is(VIEW_MODE.DAY)) {
            const x =
                (date_utils.diff(date_utils.today(), this.gantt_start, 'hour') /
                    this.options.step) *
                this.options.column_width;
            const y = 0;

            const width = this.options.column_width;
            const height =
                (this.options.bar_height + this.options.padding) *
                    this.tasks.length +
                this.options.header_height +
                this.options.padding / 2;

            createSVG('rect', {
                x,
                y,
                width,
                height,
                class: 'today-highlight',
                append_to: this.layers.grid,
            });
        }
    }

    make_dates() {
        const pageScroll = window.scrollY;
        const originOffset =
            pageScroll + this.$wrapper.getBoundingClientRect().top;

        if (originOffset <= pageScroll) {
            this.layers.date.style.transform = `translate(0px, ${Math.floor(
                window.scrollY - originOffset
            )}px)`;
        }

        for (let date of this.get_dates_to_draw()) {
            createSVG('text', {
                x: date.lower_x,
                y: date.lower_y,
                innerHTML: date.lower_text,
                class: 'lower-text',
                append_to: this.layers.date,
            });

            if (date.upper_text) {
                const $upper_text = createSVG('text', {
                    x: date.upper_x,
                    y: date.upper_y,
                    innerHTML: date.upper_text,
                    class: 'upper-text',
                    append_to: this.layers.date,
                });

                // remove out-of-bound dates
                if (
                    $upper_text.getBBox().x2 > this.layers.grid.getBBox().width
                ) {
                    $upper_text.remove();
                }
            }
        }
    }

    get_dates_to_draw() {
        let last_date = null;
        const dates = this.dates.map((date, i) => {
            const d = this.get_date_info(date, last_date, i);
            last_date = date;
            return d;
        });
        return dates;
    }

    get_date_info(date, last_date, i) {
        if (!last_date) {
            last_date = date_utils.add(date, 1, 'year');
        }
        const date_text = {
            'Quarter Day_lower': date_utils.format(
                date,
                'HH',
                this.options.language
            ),
            'Half Day_lower': date_utils.format(
                date,
                'HH',
                this.options.language
            ),
            Day_lower:
                date.getDate() !== last_date.getDate()
                    ? date_utils.format(date, 'D', this.options.language)
                    : '',
            Week_lower:
                date.getMonth() !== last_date.getMonth()
                    ? date_utils.format(date, 'D MMM', this.options.language)
                    : date_utils.format(date, 'D', this.options.language),
            Month_lower: date_utils.format(date, 'MMMM', this.options.language),
            Year_lower: date_utils.format(date, 'YYYY', this.options.language),
            'Quarter Day_upper':
                date.getDate() !== last_date.getDate()
                    ? date_utils.format(date, 'D MMM', this.options.language)
                    : '',
            'Half Day_upper':
                date.getDate() !== last_date.getDate()
                    ? date.getMonth() !== last_date.getMonth()
                        ? date_utils.format(
                              date,
                              'D MMM',
                              this.options.language
                          )
                        : date_utils.format(date, 'D', this.options.language)
                    : '',
            Day_upper:
                date.getMonth() !== last_date.getMonth()
                    ? date_utils.format(date, 'MMMM', this.options.language)
                    : '',
            Week_upper:
                date.getMonth() !== last_date.getMonth()
                    ? date_utils.format(date, 'MMMM', this.options.language)
                    : '',
            Month_upper:
                date.getFullYear() !== last_date.getFullYear()
                    ? date_utils.format(date, 'YYYY', this.options.language)
                    : '',
            Year_upper:
                date.getFullYear() !== last_date.getFullYear()
                    ? date_utils.format(date, 'YYYY', this.options.language)
                    : '',
        };

        const base_pos = {
            x: i * this.options.column_width,
            lower_y: this.options.header_height,
            upper_y: this.options.header_height - 25,
        };

        const x_pos = {
            'Quarter Day_lower': (this.options.column_width * 4) / 2,
            'Quarter Day_upper': 0,
            'Half Day_lower': (this.options.column_width * 2) / 2,
            'Half Day_upper': 0,
            Day_lower: this.options.column_width / 2,
            Day_upper: (this.options.column_width * 30) / 2,
            Week_lower: 0,
            Week_upper: (this.options.column_width * 4) / 2,
            Month_lower: this.options.column_width / 2,
            Month_upper: (this.options.column_width * 12) / 2,
            Year_lower: this.options.column_width / 2,
            Year_upper: (this.options.column_width * 30) / 2,
        };

        return {
            upper_text: date_text[`${this.options.view_mode}_upper`],
            lower_text: date_text[`${this.options.view_mode}_lower`],
            upper_x: base_pos.x + x_pos[`${this.options.view_mode}_upper`],
            upper_y: base_pos.upper_y,
            lower_x: base_pos.x + x_pos[`${this.options.view_mode}_lower`],
            lower_y: base_pos.lower_y,
        };
    }

    make_bars() {
        this.bars = this.tasks.map((task) => {
            const bar = new Bar(this, task);
            this.layers.bar.appendChild(bar.group);
            return bar;
        });
    }

    make_arrows() {
        this.arrows = [];
        for (let task of this.tasks) {
            let arrows = [];
            arrows = task.dependencies
                .map((task_id) => {
                    const dependency = this.get_task(task_id);
                    if (!dependency) return;
                    const arrow = new Arrow(
                        this,
                        this.bars[dependency._index], // from_task
                        this.bars[task._index] // to_task
                    );
                    this.layers.arrow.appendChild(arrow.element);
                    return arrow;
                })
                .filter(Boolean); // filter falsy values
            this.arrows = this.arrows.concat(arrows);
        }
    }

    map_arrows_on_bars() {
        for (let bar of this.bars) {
            bar.arrows = this.arrows.filter((arrow) => {
                return (
                    arrow.from_task.task.id === bar.task.id ||
                    arrow.to_task.task.id === bar.task.id
                );
            });
        }
    }

    set_width() {
        const cur_width = this.$svg.getBoundingClientRect().width;
        const actual_width = this.$svg
            .querySelector('.grid .grid-row')
            .getAttribute('width');
        if (cur_width < actual_width) {
            this.$svg.setAttribute('width', actual_width);
        }
    }

    set_scroll_position() {
        const parent_element = this.$svg.parentElement;
        if (!parent_element) return;

        const hours_before_first_task = date_utils.diff(
            this.get_oldest_starting_date(),
            this.gantt_start,
            'hour'
        );

        const scroll_pos =
            (hours_before_first_task / this.options.step) *
                this.options.column_width -
            this.options.column_width;

        parent_element.scrollLeft = scroll_pos;
    }

    bind_scroll_event() {
        const originOffset =
            window.scrollY + this.$wrapper.getBoundingClientRect().top;
        const $table_header = $('.table-header');
        let ticking = false;

        $.bind(
            window,
            'scroll',
            () => {
                const pageScroll = window.scrollY;

                if (ticking) return;

                ticking = true;
                window.requestAnimationFrame(() => {
                    if (originOffset <= pageScroll) {
                        $table_header.style.top = `${Math.floor(
                            pageScroll - originOffset
                        )}px`;
                        this.layers.header.style.transform = `translate(0px, ${Math.floor(
                            pageScroll - originOffset
                        )}px)`;
                        this.layers.date.style.transform = `translate(0px, ${Math.floor(
                            pageScroll - originOffset
                        )}px)`;
                    } else {
                        $table_header.style.top = '0px';
                        this.layers.header.style.transform =
                            'translate(0px, 0px)';
                        this.layers.date.style.transform =
                            'translate(0px, 0px)';
                    }

                    ticking = false;
                });
            },
            { passive: true }
        );
    }

    bind_grid_click() {
        $.on(
            this.$svg,
            this.options.popup_trigger,
            '.grid-row, .grid-header',
            () => {
                this.unselect_all();
                this.hide_popup();
            }
        );
    }

    bind_bar_events() {
        let is_dragging = false;
        let x_on_start = 0;
        let y_on_start = 0;
        let is_resizing_left = false;
        let is_resizing_right = false;
        let parent_bar_id = null;
        let bars = []; // instanceof Bar
        this.bar_being_dragged = null;

        function action_in_progress() {
            return is_dragging || is_resizing_left || is_resizing_right;
        }

        $.on(this.$svg, 'mousedown', '.bar-wrapper, .handle', (e, element) => {
            const bar_wrapper = $.closest('.bar-wrapper', element);

            if (element.classList.contains('left')) {
                is_resizing_left = true;
            } else if (element.classList.contains('right')) {
                is_resizing_right = true;
            } else if (element.classList.contains('bar-wrapper')) {
                is_dragging = true;
            }

            bar_wrapper.classList.add('active');

            x_on_start = e.offsetX;
            y_on_start = e.offsetY;

            parent_bar_id = bar_wrapper.getAttribute('data-id');
            const ids = [
                parent_bar_id,
                ...this.get_all_dependent_tasks(parent_bar_id),
            ];
            bars = ids.map((id) => this.get_bar(id));

            this.bar_being_dragged = parent_bar_id;

            bars.forEach((bar) => {
                const $bar = bar.$bar;
                $bar.ox = $bar.getX();
                $bar.oy = $bar.getY();
                $bar.owidth = $bar.getWidth();
                $bar.finaldx = 0;
            });
        });

        $.on(this.$svg, 'mousemove', (e) => {
            if (!action_in_progress()) return;
            const dx = e.offsetX - x_on_start;
            const dy = e.offsetY - y_on_start;

            bars.forEach((bar) => {
                const $bar = bar.$bar;
                $bar.finaldx = this.get_snap_position(dx);
                this.hide_popup();
                if (is_resizing_left) {
                    if (parent_bar_id === bar.task.id) {
                        bar.update_bar_position({
                            x: $bar.ox + $bar.finaldx,
                            width: $bar.owidth - $bar.finaldx,
                        });
                    } else {
                        bar.update_bar_position({
                            x: $bar.ox + $bar.finaldx,
                        });
                    }
                } else if (is_resizing_right) {
                    if (parent_bar_id === bar.task.id) {
                        bar.update_bar_position({
                            width: $bar.owidth + $bar.finaldx,
                        });
                    }
                } else if (is_dragging) {
                    bar.update_bar_position({ x: $bar.ox + $bar.finaldx });
                }
            });
        });

        document.addEventListener('mouseup', (e) => {
            if (is_dragging || is_resizing_left || is_resizing_right) {
                bars.forEach((bar) => bar.group.classList.remove('active'));
            }

            is_dragging = false;
            is_resizing_left = false;
            is_resizing_right = false;
        });

        $.on(this.$svg, 'mouseup', (e) => {
            this.bar_being_dragged = null;
            bars.forEach((bar) => {
                const $bar = bar.$bar;
                if (!$bar.finaldx) return;
                bar.date_changed();
                bar.set_action_completed();
            });
        });

        this.bind_bar_progress();
    }

    bind_bar_progress() {
        let x_on_start = 0;
        let y_on_start = 0;
        let is_resizing = null;
        let bar = null;
        let $bar_progress = null;
        let $bar = null;

        $.on(this.$svg, 'mousedown', '.handle.progress', (e, handle) => {
            is_resizing = true;
            x_on_start = e.offsetX;
            y_on_start = e.offsetY;

            const $bar_wrapper = $.closest('.bar-wrapper', handle);
            const id = $bar_wrapper.getAttribute('data-id');
            bar = this.get_bar(id);

            $bar_progress = bar.$bar_progress;
            $bar = bar.$bar;

            $bar_progress.finaldx = 0;
            $bar_progress.owidth = $bar_progress.getWidth();
            $bar_progress.min_dx = -$bar_progress.getWidth();
            $bar_progress.max_dx = $bar.getWidth() - $bar_progress.getWidth();
        });

        $.on(this.$svg, 'mousemove', (e) => {
            if (!is_resizing) return;
            let dx = e.offsetX - x_on_start;
            let dy = e.offsetY - y_on_start;

            if (dx > $bar_progress.max_dx) {
                dx = $bar_progress.max_dx;
            }
            if (dx < $bar_progress.min_dx) {
                dx = $bar_progress.min_dx;
            }

            const $handle = bar.$handle_progress;
            $.attr($bar_progress, 'width', $bar_progress.owidth + dx);
            $.attr($handle, 'points', bar.get_progress_polygon_points());
            $bar_progress.finaldx = dx;
        });

        $.on(this.$svg, 'mouseup', () => {
            is_resizing = false;
            if (!($bar_progress && $bar_progress.finaldx)) return;
            bar.progress_changed();
            bar.set_action_completed();
        });
    }

    get_all_dependent_tasks(task_id) {
        let out = [];
        let to_process = [task_id];
        while (to_process.length) {
            const deps = to_process.reduce((acc, curr) => {
                acc = acc.concat(this.dependency_map[curr]);
                return acc;
            }, []);

            out = out.concat(deps);
            to_process = deps.filter((d) => !to_process.includes(d));
        }

        return out.filter(Boolean);
    }

    get_snap_position(dx) {
        let odx = dx,
            rem,
            position;

        if (this.view_is(VIEW_MODE.WEEK)) {
            rem = dx % (this.options.column_width / 7);
            position =
                odx -
                rem +
                (rem < this.options.column_width / 14
                    ? 0
                    : this.options.column_width / 7);
        } else if (this.view_is(VIEW_MODE.MONTH)) {
            rem = dx % (this.options.column_width / 30);
            position =
                odx -
                rem +
                (rem < this.options.column_width / 60
                    ? 0
                    : this.options.column_width / 30);
        } else {
            rem = dx % this.options.column_width;
            position =
                odx -
                rem +
                (rem < this.options.column_width / 2
                    ? 0
                    : this.options.column_width);
        }
        return position;
    }

    unselect_all() {
        [...this.$svg.querySelectorAll('.bar-wrapper')].forEach((el) => {
            el.classList.remove('active');
        });
    }

    view_is(modes) {
        if (typeof modes === 'string') {
            return this.options.view_mode === modes;
        }

        if (Array.isArray(modes)) {
            return modes.some((mode) => this.options.view_mode === mode);
        }

        return false;
    }

    get_task(id) {
        return this.tasks.find((task) => {
            return task.id === id;
        });
    }

    get_bar(id) {
        return this.bars.find((bar) => {
            return bar.task.id === id;
        });
    }

    show_popup(options) {
        if (!this.popup) {
            this.popup = new Popup(
                this.popup_wrapper,
                this.options.custom_popup_html
            );
        }
        this.popup.show(options);
    }

    hide_popup() {
        this.popup && this.popup.hide();
    }

    trigger_event(event, args) {
        if (this.options['on_' + event]) {
            this.options['on_' + event].apply(null, args);
        }
    }

    /**
     * Gets the oldest starting date from the list of tasks
     *
     * @returns Date
     * @memberof Gantt
     */
    get_oldest_starting_date() {
        return this.tasks
            .map((task) => task._start)
            .reduce((prev_date, cur_date) =>
                cur_date <= prev_date ? cur_date : prev_date
            );
    }

    /**
     * Clear all elements from the parent svg element
     *
     * @memberof Gantt
     */
    clear() {
        this.$svg.innerHTML = '';
    }
}

Gantt.VIEW_MODE = VIEW_MODE;

function generate_id(task) {
    return task.name + '_' + Math.random().toString(36).slice(2, 12);
}
