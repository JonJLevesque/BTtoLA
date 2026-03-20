/**
 * Diagram Generator — Inline SVG flow diagrams for migration reports.
 *
 * Produces two diagrams:
 *   1. BizTalk Architecture — Receive Locations → Pipelines → Orchestrations → Send Ports
 *   2. Logic Apps Architecture — generated workflows with trigger/action summary
 *
 * Output is raw HTML (SVG + details table) suitable for embedding in the HTML report.
 */

import type { BizTalkApplication } from '../types/biztalk.js';
import type { WorkflowJson } from '../types/logicapps.js';

// ─── Colours ──────────────────────────────────────────────────────────────────

const COLORS = {
  receive:      { fill: '#d4edda', stroke: '#28a745', text: '#155724' },
  pipeline:     { fill: '#cce5ff', stroke: '#0056b3', text: '#004085' },
  orchestration:{ fill: '#e2d9f3', stroke: '#6f42c1', text: '#432874' },
  sendport:     { fill: '#fff3cd', stroke: '#d39e00', text: '#7d5a00' },
  workflow:     { fill: '#cce5ff', stroke: '#0078d4', text: '#004578' },
  trigger:      { fill: '#d4edda', stroke: '#28a745', text: '#155724' },
};

// ─── Layout constants ─────────────────────────────────────────────────────────

const NODE_W   = 160;
const NODE_H   = 50;
const COL_GAP  = 220;
const ROW_GAP  = 70;
const PAD_X    = 20;
const PAD_Y    = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

interface DiagramNode {
  id:    string;
  label: string;
  sub:   string;
  kind:  keyof typeof COLORS;
  col:   number;
  row:   number;
}

interface DiagramEdge {
  from: string;
  to:   string;
}

// ─── SVG builder helpers ──────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, max = 18): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function nodeX(col: number): number { return PAD_X + col * COL_GAP; }
function nodeY(row: number): number { return PAD_Y + row * ROW_GAP; }
function nodeCx(col: number): number { return nodeX(col) + NODE_W / 2; }
function nodeCy(row: number): number { return nodeY(row) + NODE_H / 2; }

function renderNode(n: DiagramNode): string {
  const c = COLORS[n.kind];
  const x = nodeX(n.col);
  const y = nodeY(n.row);
  return `
  <g class="dia-node" data-id="${esc(n.id)}">
    <rect x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" rx="8"
      fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>
    <text x="${x + NODE_W / 2}" y="${y + 19}" text-anchor="middle"
      font-family="system-ui,-apple-system,sans-serif" font-size="12" font-weight="600"
      fill="${c.text}">${esc(truncate(n.label, 20))}</text>
    <text x="${x + NODE_W / 2}" y="${y + 34}" text-anchor="middle"
      font-family="system-ui,-apple-system,sans-serif" font-size="10"
      fill="${c.stroke}">${esc(truncate(n.sub, 24))}</text>
  </g>`;
}

function renderEdge(from: DiagramNode, to: DiagramNode): string {
  const x1 = nodeX(from.col) + NODE_W;
  const y1 = nodeCy(from.row);
  const x2 = nodeX(to.col);
  const y2 = nodeCy(to.row);
  const mx = (x1 + x2) / 2;
  return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"
    fill="none" stroke="#9ca3af" stroke-width="1.5" marker-end="url(#arrow)"/>`;
}

function svgWrapper(nodes: DiagramNode[], edges: DiagramEdge[]): string {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const cols = nodes.reduce((m, n) => Math.max(m, n.col), 0) + 1;
  const rows = nodes.reduce((m, n) => Math.max(m, n.row), 0) + 1;
  const svgW = PAD_X * 2 + cols * COL_GAP - (COL_GAP - NODE_W);
  const svgH = PAD_Y * 2 + rows * ROW_GAP - (ROW_GAP - NODE_H);

  const edgeSvg = edges.map(e => {
    const f = nodeMap.get(e.from);
    const t = nodeMap.get(e.to);
    if (!f || !t) return '';
    return renderEdge(f, t);
  }).join('');

  const nodeSvg = nodes.map(renderNode).join('');

  return `<svg viewBox="0 0 ${svgW} ${svgH}" width="100%" preserveAspectRatio="xMinYMin meet"
  xmlns="http://www.w3.org/2000/svg" style="max-height:400px;overflow:visible">
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L0,6 L8,3 z" fill="#9ca3af"/>
    </marker>
  </defs>
  ${edgeSvg}
  ${nodeSvg}
</svg>`;
}

// ─── BizTalk Architecture Diagram ─────────────────────────────────────────────

export function generateBizTalkDiagram(app: BizTalkApplication): string {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];

  const receiveLocations = app.bindingFiles.flatMap(b => b.receiveLocations);
  const sendPorts        = app.bindingFiles.flatMap(b => b.sendPorts);
  const rcvPipelines     = [...new Set(receiveLocations.map(r => r.pipelineName).filter(Boolean))];
  const sndPipelines     = [...new Set(sendPorts.map(s => s.pipelineName).filter(Boolean))];
  const orchestrations   = app.orchestrations;

  // Column layout: ReceiveLocations | RcvPipelines | Orchestrations | SndPipelines | SendPorts
  let col = 0;

  // Col 0: Receive Locations
  receiveLocations.forEach((rl, i) => {
    nodes.push({ id: `rl_${i}`, label: rl.name, sub: rl.adapterType, kind: 'receive', col, row: i });
  });

  if (receiveLocations.length > 0 && rcvPipelines.length > 0) col++;
  else if (receiveLocations.length > 0) col++;

  // Col 1: Receive Pipelines
  if (rcvPipelines.length > 0) {
    rcvPipelines.forEach((p, i) => {
      const nodeId = `rp_${i}`;
      nodes.push({ id: nodeId, label: p, sub: 'Receive Pipeline', kind: 'pipeline', col, row: i });
      // connect receive locations to this pipeline
      receiveLocations.forEach((rl, ri) => {
        if (rl.pipelineName === p) edges.push({ from: `rl_${ri}`, to: nodeId });
      });
    });
    col++;
  }

  // Col 2: Orchestrations
  if (orchestrations.length > 0) {
    orchestrations.forEach((orch, i) => {
      const nodeId = `orch_${i}`;
      nodes.push({ id: nodeId, label: orch.name, sub: 'Orchestration', kind: 'orchestration', col, row: i });
      // connect receive pipelines to orchestrations
      if (rcvPipelines.length > 0) {
        rcvPipelines.forEach((_, ri) => edges.push({ from: `rp_${ri}`, to: nodeId }));
      } else if (receiveLocations.length > 0) {
        receiveLocations.forEach((_, ri) => edges.push({ from: `rl_${ri}`, to: nodeId }));
      }
    });
    col++;
  }

  // Col 3: Send Pipelines
  if (sndPipelines.length > 0) {
    sndPipelines.forEach((p, i) => {
      const nodeId = `sp_${i}`;
      nodes.push({ id: nodeId, label: p, sub: 'Send Pipeline', kind: 'pipeline', col, row: i });
      if (orchestrations.length > 0) {
        orchestrations.forEach((_, oi) => edges.push({ from: `orch_${oi}`, to: nodeId }));
      }
    });
    col++;
  }

  // Col 4: Send Ports
  sendPorts.forEach((sp, i) => {
    const nodeId = `spt_${i}`;
    nodes.push({ id: nodeId, label: sp.name, sub: sp.adapterType, kind: 'sendport', col, row: i });
    if (sndPipelines.length > 0) {
      sndPipelines.forEach((p, si) => {
        if (sp.pipelineName === p) edges.push({ from: `sp_${si}`, to: nodeId });
      });
    } else if (orchestrations.length > 0) {
      orchestrations.forEach((_, oi) => edges.push({ from: `orch_${oi}`, to: nodeId }));
    } else if (receiveLocations.length > 0) {
      receiveLocations.forEach((_, ri) => edges.push({ from: `rl_${ri}`, to: nodeId }));
    }
  });

  if (nodes.length === 0) return '';

  const svg = svgWrapper(nodes, edges);

  // Details table below the diagram
  const rows: string[] = [];
  receiveLocations.forEach(rl =>
    rows.push(`<tr><td>Receive Location</td><td><strong>${esc(rl.name)}</strong></td><td>${esc(rl.adapterType)}</td><td><code>${esc(rl.address)}</code></td></tr>`)
  );
  app.orchestrations.forEach(orch =>
    rows.push(`<tr><td>Orchestration</td><td><strong>${esc(orch.name)}</strong></td><td>${orch.shapes.length} shapes</td><td></td></tr>`)
  );
  sendPorts.forEach(sp =>
    rows.push(`<tr><td>Send Port</td><td><strong>${esc(sp.name)}</strong></td><td>${esc(sp.adapterType)}</td><td><code>${esc(sp.address)}</code></td></tr>`)
  );

  return `
<div class="dia-wrap">
  <div class="dia-svg-wrap">${svg}</div>
  <details class="dia-details">
    <summary>View artifact details</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Type</th><th>Name</th><th>Adapter / Info</th><th>Address</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </details>
</div>`;
}

// ─── Logic Apps Architecture Diagram ──────────────────────────────────────────

export function generateLogicAppsDiagram(
  workflows: Array<{ name: string; workflow: WorkflowJson }>
): string {
  if (workflows.length === 0) return '';

  const nodes: DiagramNode[] = [];

  workflows.forEach((wf, i) => {
    const def       = wf.workflow.definition;
    const triggers  = Object.keys(def.triggers ?? {});
    const actions   = Object.keys(def.actions ?? {});
    const trigName  = triggers[0] ?? 'trigger';
    const actCount  = actions.length;
    const sub       = actCount > 0 ? `${actCount} action${actCount !== 1 ? 's' : ''}` : 'no actions';

    // Trigger node
    nodes.push({
      id:    `trig_${i}`,
      label: trigName.replace(/_/g, ' '),
      sub:   'Trigger',
      kind:  'trigger',
      col:   0,
      row:   i,
    });

    // Workflow node
    nodes.push({
      id:    `wf_${i}`,
      label: wf.name,
      sub,
      kind:  'workflow',
      col:   1,
      row:   i,
    });
  });

  const edges: DiagramEdge[] = workflows.map((_, i) => ({ from: `trig_${i}`, to: `wf_${i}` }));

  const svg = svgWrapper(nodes, edges);

  const rows = workflows.map(wf => {
    const def      = wf.workflow.definition;
    const triggers = Object.keys(def.triggers ?? {});
    const actions  = Object.keys(def.actions ?? {});
    return `<tr><td><strong>${esc(wf.name)}</strong></td><td>${esc(triggers.join(', ') || '—')}</td><td>${actions.length}</td><td>${esc(wf.workflow.kind ?? 'Stateful')}</td></tr>`;
  });

  return `
<div class="dia-wrap">
  <div class="dia-svg-wrap">${svg}</div>
  <details class="dia-details">
    <summary>View workflow details</summary>
    <div class="table-wrap"><table>
      <thead><tr><th>Workflow</th><th>Trigger</th><th>Actions</th><th>Kind</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table></div>
  </details>
</div>`;
}
