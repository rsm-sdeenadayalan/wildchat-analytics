# Dashboard design

**What this is for:** Fix what the dashboard shows and how a reader interacts with it before the build is judged.
**Date:** 2026-09-20
**Status:** Final

## Who reads it and when

Priya, the PM persona from the PRD, opens the dashboard on a Monday morning with about five minutes and one question in mind: is usage growing, what are people using the assistant for, or where is it failing. She reads one view, gets an answer with its caveat, and closes the tab.

## Information hierarchy

- Tiles answer "how much" in three seconds. A headline number needing no comparison is a stat tile, not a chart; a chart earns its place only for change, distribution, or composition.
- One chart per question. No chart carries two unrelated questions or uses two y-axes to fake that it does; two measures of different scale become two charts instead.
- Caveats are always visible, rendered as on-page text, never behind a link.
- Query is where everything else lives: any question the five fixed views did not anticipate, against the same aggregates.

## Views

**Overview.** "How much is happening, and is anyone coming back." Six tiles: conversations, turns, weeks covered, peak weekly pseudo-users, return rate for the latest complete week (with its week date), intent coverage. Then the view's insight card asks "Is usage growing, or is it the same power users?" and answers it from the aggregates: conversations over the last 12 complete weeks against the 12 before, the latest top-10% concentration, and which model served recent traffic, with a link to finding F3. Below, one line chart of weekly conversations by model with a clickable legend. Hover gives a tooltip on every point.

**Intensity.** "Is growth broad or concentrated, and did people come back." Tiles carry the week they describe, and the return tile names the latest week that has a following week to measure, so it is never blank. The insight card asks "Are people coming back?" and answers with the pre-break median return rate, the collection change that makes later weeks incomparable, and the single-turn share by model, linking to F1, F2 and F4. The return-rate line draws `NULL` weeks (no following week to measure) as gaps, not interpolated. Every weekly chart on this view carries a dashed vertical rule labeled "collection break" at 2024-10. Pseudo-users and concentration are two aligned panels on one time axis: pseudo-users per week as a filled area above, top-10% share as a line below with a reference line at 50%, so "fewer people, more concentrated" reads at a glance. (The first version encoded the share as the color of a single line; a design review found it unreadable and it was replaced on 2026-10-02.) Conversations per pseudo-user shows the median (solid) and 90th percentile (dashed) in two colors with a legend. A bar chart shows the share of pseudo-users active in more than one week, by quarter, with post-break quarters in a muted tone. Session depth is one horizontal 100% stacked bar per model family, colored by turn bucket on a sequential ramp and sorted by single-turn share; isolating a bucket from the legend ranks the models on it. (The first version used nine small multiples, whose axis labels collided.) Tooltips on every mark; gaps never filled in.

**Intent.** "What are people trying to do." The insight card asks "What are people using it for, and what is shifting?" and answers with the two largest classes, the biggest riser and faller over the last 12 complete weeks against the 12 before, and the share of `other` (greetings, tests, gibberish) in recent traffic, linking to F8 to F10. A collapsed reliability card follows: held-out accuracy against the two-rater ceiling in one line, expanding to the gate and per-class F1, so a reader knows which class differences are real before reading a chart. A 100% stacked area shows intent share by week; isolating one class from the legend redraws it as a single share line, which is how a trend in one class is actually read. Two 100% stacked bar sets repeat the same seven classes by model family and by the top ten languages; isolating a class ranks the models or languages on it. Classes keep one color across all three charts, assigned in volume order.

**Friction.** "Where is the assistant failing people." The insight card asks "Where does the assistant fail people most?" and answers with the worst refusal cell among intent × model pairs with at least 1,000 conversations, the one-and-done trend over the last 12 complete weeks, and which real-work intents draw the most single-turn exits and refusals, linking to F5 and F11. Four proxy rates over time (repeated request, correction follow-up, refusal, one-and-done) run as four lines with a clickable legend, on a percent-formatted axis that autoscales to the data. A heatmap has the four signals on one axis and intent-and-model rows on the other, one sequential hue for the rate, never doubling as identity. A table below gives each intent's count and the same four rates with all models combined, so a striking percentage over a small denominator cannot be over-read. A proxy failing its 70% precision gate is dropped outright, not softened; with intent unlabeled, the heatmap and table fall back to "not available" while the weekly lines, which need no intent, still render.

**Data quality.** "How much to trust everything else." Tiles: minimum cell size (20), shards processed (86 of 86), taxonomy version, aggregate set size. The insight card asks "What in these numbers can I trust?" and answers with intent label coverage and classifier accuracy against the rater ceiling, the share of conversations without a usable country, and token-field coverage, linking to F6 and F7. Below: redaction and empty-input rate as two lines with a legend, on a percent-formatted axis; token-usage coverage over time, labeled with the window it covers from 2024-09-09; top-countries and top-languages bars, each with an explicit `suppressed_or_unknown` bar drawn like the others and named in the card note; a distinct muted tone for that row is planned polish.

**Query.** Whatever the other five views did not anticipate. A SQL textarea runs against the twelve committed aggregate views, capped at 200 rows, with a visible error line for a bad query. No chart here; it is the escape valve.

## Wireframes

At 400 px, tab pills wrap onto two or three rows, not a menu; tables scroll inside their card; charts scale to the card width.

**Overview, desktop.**
```
+---------------------------------------------+
| Loupe   [Overview][Intensity]...[Query]      |
| banner                                       |
+---------------------------------------------+
| [Convs][Turns][Weeks][Peak][Return][Intent]  |
+---------------------------------------------+
| weekly-convs-by-model line, legend           |
+---------------------------------------------+
| caveats, ODC-By                              |
+---------------------------------------------+
```

**Overview, 400 px.**
```
+----------------+
| Loupe          |
| [Ov][Int][Fr]  |
| [DQ][In][Qry]  |
| banner         |
+----------------+
| [Convs][Turns] |
| [Weeks][Peak]  |
| [Return][Int]  |
+----------------+
| chart, scaled  |
+----------------+
| caveats        |
+----------------+
```

**Friction, desktop.**
```
+---------------------------------------------+
| Loupe   [Overview]...[Friction]...[Query]    |
| banner                                       |
+---------------------------------------------+
| proxy-rates-over-time lines, legend          |
+---------------------------------------------+
| heatmap: x=4-signals, y=intent-model, ramp   |
+---------------------------------------------+
| table: intent, n, 4-rates (models-combined)  |
+---------------------------------------------+
| caveats, ODC-By                              |
+---------------------------------------------+
```

**Friction, 400 px.**
```
+----------------+
| Loupe          |
| [Ov][Int][Fr]  |
| [DQ][In][Qry]  |
| banner         |
+----------------+
| rates, legend  |
+----------------+
| heatmap scroll |
+----------------+
| table scroll   |
+----------------+
| caveats        |
+----------------+
```

## Interaction rules

Tooltips appear on every mark, on hover and on tap. Every chart has its own legend, drawn by the app rather than the plotting library so it can act as a control: clicking a series isolates it, shift-clicking adds or removes series to compare, hovering a chip dims the others, and "Show all" restores the chart. Isolation is per chart; a model picker that filters every view at once would need aggregates cut by model that are not published, and sits on the roadmap. Each chart title is followed by a one-line "so what" computed from the data (latest value, change against the prior 12 weeks, or the ranking the chart shows); the definition of the measure moves under a "What this measures" disclosure so it is available without competing with the reading. The partial final week is excluded from every weekly chart and tile. Nothing animates: a static build regenerated by one batch command, at most weekly, so motion would imply a cadence the pipeline does not have. Color comes from the palette tokens. Rates use percent-formatted axes that autoscale to the data. Suppression is noted in the card note wherever `min_cell` applies. The suppressed_or_unknown row is drawn in a muted tone and named in the card note. Intent colors are fixed per class across the three intent charts.

## Deliberately absent

- **Maps.** Small-cell suppression leaves most geographic cells too thin to show responsibly, and a map's precision invites over-reading exactly the cells it should hide.
- **Per-user tables.** A pseudo-user key is pseudonymous personal data; a row-scannable table defeats the aggregate-only design regardless of suppression above it.
- **Raw transcripts.** No row-level conversation content is served by the dashboard, and nothing links out to one.
- **Real time.** Aggregates regenerate from one batch command, never more often than weekly; a live indicator would promise a cadence the pipeline cannot keep.
- **Filters that would create small cells.** Any combination that could produce a cell under `min_cell` stays out; country and language show a fixed top set plus one residual, not an open filter.
