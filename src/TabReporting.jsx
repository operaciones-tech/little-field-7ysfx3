import { useState, useMemo, useCallback, useRef } from "react";
import * as XLSX from "xlsx";
import {
  ESTADOS,
  SOCIOS,
  fmtARSFull,
  fmtARS,
  parseDate,
  calcDelay,
  lastFridayInputDate,
  currentWeekNumber,
  weekNumberFromDate,
  todayInputDate,
  esExcluido,
  SALDOS_KEY,
  USER_KEY,
} from "./constants";

// ─────────────────────────────────────────────────────
// CONSTANTES SALDOS CC
// ─────────────────────────────────────────────────────
const UNIF_KEY = "galarraga_unificaciones_cc";

function parseSaldoStr(s) {
  if (!s || s === "$ -") return 0;
  // SheetJS ya parseó el número — usarlo directo
  if (typeof s === "number") return s;
  const str = String(s).trim();
  const neg = str.startsWith("-");
  const limpio = str.replace(/[^0-9.,]/g, "");
  const num = parseFloat(limpio.replace(/\./g, "").replace(",", "."));
  if (isNaN(num)) return 0;
  return neg ? -num : num;
}

function fmtSaldoAR(n) {
  const abs = Math.abs(n);
  const parts = abs.toFixed(2).split(".");
  const entero = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const dec = parts[1];
  const formatted = `$ ${entero},${dec}`;
  return n < 0 ? `-${formatted}` : formatted;
}

// ─────────────────────────────────────────────────────
// SUB-TAB: SALDOS CC CLIENTES DE LA CASA
// ─────────────────────────────────────────────────────
function SubTabSaldosCC() {
  const fileInputC1Ref = useRef(null);
  const fileInputC2Ref = useRef(null);

  const [rawC1, setRawC1] = useState(null);
  const [rawC2, setRawC2] = useState(null);
  const [fechaReporte, setFechaReporte] = useState("");
  const [copiado, setCopiado] = useState(false);

  const [unificaciones, setUnificaciones] = useState(() => {
    try {
      const saved = localStorage.getItem(UNIF_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  const [seleccionados, setSeleccionados] = useState(new Set());
  const [comentarios, setComentarios] = useState({});
  const [comentariosAcreedor, setComentariosAcreedor] = useState({});

  const [showUnifModal, setShowUnifModal] = useState(false);
  const [unifOrigen, setUnifOrigen] = useState([""]);
  const [unifDestino, setUnifDestino] = useState("");

  const guardarUnificaciones = (next) => {
    setUnificaciones(next);
    localStorage.setItem(UNIF_KEY, JSON.stringify(next));
  };

  const parseXlsx = (buffer) => {
    const wb = XLSX.read(buffer, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!data || data.length < 2) return null;
    const header = data[0];
    const fecha = header[2] || "";
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      const r = data[i];
      if (!r || !r[0]) continue;
      const nombre = String(r[0]).trim();
      const alias = r[1] != null ? String(r[1]).replace(/\.0$/, "") : "";
      const saldo = parseSaldoStr(r[2]);
      if (saldo === 0) continue;
      rows.push({ nombre, alias, saldo });
    }
    return { rows, fecha: String(fecha) };
  };

  const handleFile = (e, setCuenta) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const buf = new Uint8Array(ev.target.result);
      const parsed = parseXlsx(buf);
      if (parsed) setCuenta(parsed);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const consolidado = useMemo(() => {
    if (!rawC1 && !rawC2) return [];
    const unifMap = {};
    unificaciones.forEach((u) => {
      u.origenes.forEach((orig) => {
        unifMap[orig.toUpperCase().trim()] = u.destino.trim();
      });
    });
    const mapa = {};
    const procesarRows = (rows) => {
      if (!rows) return;
      rows.forEach((r) => {
        const key = unifMap[r.nombre.toUpperCase().trim()] || r.nombre;
        if (!mapa[key]) mapa[key] = { nombre: key, saldo: 0 };
        mapa[key].saldo += r.saldo;
      });
    };
    procesarRows(rawC1?.rows);
    procesarRows(rawC2?.rows);
    return Object.values(mapa)
      .filter((r) => Math.abs(r.saldo) >= 0.01)
      .sort((a, b) => b.saldo - a.saldo);
  }, [rawC1, rawC2, unificaciones]);

  const deudores = useMemo(
    () => consolidado.filter((r) => r.saldo > 0),
    [consolidado]
  );
  const acreedores = useMemo(
    () => consolidado.filter((r) => r.saldo < 0),
    [consolidado]
  );

  const todosNombres = useMemo(
    () => new Set(consolidado.map((r) => r.nombre)),
    [consolidado]
  );

  const toggleSeleccion = (nombre) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(nombre)) next.delete(nombre);
      else next.add(nombre);
      return next;
    });
  };

  const seleccionarTodos = (lista) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      lista.forEach((r) => next.add(r.nombre));
      return next;
    });
  };

  const deseleccionarTodos = (lista) => {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      lista.forEach((r) => next.delete(r.nombre));
      return next;
    });
  };

  const actualizarComentario = (nombre, valor) => {
    setComentarios((prev) => ({ ...prev, [nombre]: valor }));
  };

  const actualizarComentarioAcreedor = (nombre, valor) => {
    setComentariosAcreedor((prev) => ({ ...prev, [nombre]: valor }));
  };

  const nombresDisponibles = useMemo(() => {
    const set = new Set();
    rawC1?.rows?.forEach((r) => set.add(r.nombre));
    rawC2?.rows?.forEach((r) => set.add(r.nombre));
    return [...set].sort();
  }, [rawC1, rawC2]);

  const agregarOrigenUnif = () => setUnifOrigen((p) => [...p, ""]);
  const actualizarOrigenUnif = (idx, val) =>
    setUnifOrigen((p) => p.map((v, i) => (i === idx ? val : v)));
  const quitarOrigenUnif = (idx) =>
    setUnifOrigen((p) => p.filter((_, i) => i !== idx));

  const guardarUnif = () => {
    const origenes = unifOrigen.filter((o) => o.trim());
    if (origenes.length < 2 || !unifDestino.trim()) return;
    const next = [...unificaciones, { origenes, destino: unifDestino.trim() }];
    guardarUnificaciones(next);
    setShowUnifModal(false);
    setUnifOrigen([""]);
    setUnifDestino("");
  };

  const eliminarUnif = (idx) => {
    const next = unificaciones.filter((_, i) => i !== idx);
    guardarUnificaciones(next);
  };

  const generarHTMLSaldos = () => {
    const deudoresIncluidos = deudores.filter((r) =>
      seleccionados.has(r.nombre)
    );
    const acreedoresIncluidos = acreedores.filter((r) =>
      seleccionados.has(r.nombre)
    );

    const totalDeudor = deudoresIncluidos.reduce((s, r) => s + r.saldo, 0);
    const totalAcreedor = acreedoresIncluidos.reduce((s, r) => s + r.saldo, 0);

    const tdS = `style="padding:6px 12px;border:1px solid #ccc;font-size:13px;font-family:Arial,sans-serif;"`;
    const tdR = `style="padding:6px 12px;border:1px solid #ccc;font-size:13px;font-family:Arial,sans-serif;text-align:right;"`;
    const thS = `style="padding:8px 12px;border:1px solid #ccc;font-size:11px;background:#e8e8e8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;font-family:Arial,sans-serif;"`;
    const thR = `style="padding:8px 12px;border:1px solid #ccc;font-size:11px;background:#e8e8e8;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:right;font-family:Arial,sans-serif;"`;

    const filasDeudores = deudoresIncluidos
      .map(
        (r) =>
          `<tr style="background:#f0fff0;"><td ${tdS}>${
            r.nombre
          }</td><td ${tdR}>${fmtSaldoAR(r.saldo)}</td><td ${tdS}>${(
            comentarios[r.nombre] || ""
          ).replace(/</g, "&lt;")}</td></tr>`
      )
      .join("");

    const filasAcreedores = acreedoresIncluidos
      .map(
        (r) =>
          `<tr style="background:#fffff0;"><td ${tdS}>${
            r.nombre
          }</td><td ${tdR}>${fmtSaldoAR(r.saldo)}</td><td ${tdS}>${(
            comentariosAcreedor[r.nombre] || ""
          ).replace(/</g, "&lt;")}</td></tr>`
      )
      .join("");

    const tablaDeudores =
      deudoresIncluidos.length > 0
        ? `
<table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
  <thead><tr><th ${thS}>Cuenta corriente</th><th ${thR}>Saldo consolidado</th><th ${thS}>Comentarios</th></tr></thead>
  <tbody>${filasDeudores}</tbody>
  <tfoot><tr>
    <td ${tdS}></td>
    <td style="padding:8px 12px;border:1px solid #ccc;font-size:13px;font-weight:700;text-align:right;font-family:Arial,sans-serif;">${fmtSaldoAR(
      totalDeudor
    )}</td>
    <td ${tdS}></td>
  </tr></tfoot>
</table>`
        : "";

    const tablaAcreedores =
      acreedoresIncluidos.length > 0
        ? `
<table style="border-collapse:collapse;width:100%;margin-bottom:8px;">
  <thead><tr><th ${thS}>Cuenta corriente</th><th ${thR}>Saldo consolidado</th><th ${thS}>Comentarios</th></tr></thead>
  <tbody>${filasAcreedores}</tbody>
  <tfoot><tr>
    <td ${tdS}></td>
    <td style="padding:8px 12px;border:1px solid #ccc;font-size:13px;font-weight:700;text-align:right;font-family:Arial,sans-serif;">${fmtSaldoAR(
      totalAcreedor
    )}</td>
    <td ${tdS}></td>
  </tr></tfoot>
</table>`
        : "";

    const usuario = localStorage.getItem(USER_KEY) || "Galarraga";

    return `<div style="font-family:Arial,sans-serif;max-width:1000px;">
<p style="font-size:14px;color:#222;margin-bottom:16px;">Buenas tardes ¿Cómo están?<br>Se presenta un nuevo informe consolidado de saldos, elaborado a partir de la conciliación entre el Sistema 1 y el Sistema 2 sobre clientes de la casa junto con comentarios que aportan información al respecto</p>
<p style="font-size:14px;color:#222;margin-bottom:16px;">Reporte que se genera cada 15/20 días para su manejo y control</p>
<p style="font-size:14px;color:#222;margin-bottom:16px;">El saldo deudor al ${
      fechaReporte || "—"
    } es de <strong>${fmtSaldoAR(totalDeudor)}</strong></p>
${tablaDeudores}
<br>
<p style="font-size:14px;color:#222;margin-bottom:16px;">A continuación, detalle de quienes cuentan con saldo a favor, considerando que también puede ser de utilidad al momento de cerrar operaciones</p>
${tablaAcreedores}
<p style="font-size:14px;color:#222;margin-bottom:4px;">Cualquier duda o consulta, estoy a disposición</p>
<br><br>
<p style="font-size:14px;color:#222;">Luciano Goizueta<br>Administración - Consignataria Galarraga<br>Tel: 2268 - 421738 / Cel: 2268 - 631482<br><a href="mailto:info@consignatariagalarraga.com">info@consignatariagalarraga.com</a></p>
</div>`;
  };

  const copiarMail = async () => {
    const html = generarHTMLSaldos();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      await navigator.clipboard.writeText(html);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    }
  };

  const tieneData = rawC1 || rawC2;
  const deudoresSeleccionados = deudores.filter((r) =>
    seleccionados.has(r.nombre)
  );
  const acreedoresSeleccionados = acreedores.filter((r) =>
    seleccionados.has(r.nombre)
  );
  const totalDeudorSel = deudoresSeleccionados.reduce((s, r) => s + r.saldo, 0);
  const totalAcreedorSel = acreedoresSeleccionados.reduce(
    (s, r) => s + r.saldo,
    0
  );

  const inputStyle = {
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "Montserrat, sans-serif",
    outline: "none",
    color: "#1a1a2e",
    background: "#fff",
  };

  const btnUpload = {
    padding: "8px 18px",
    background: "#1877F2",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: "Montserrat, sans-serif",
    cursor: "pointer",
    transition: "background 0.2s",
  };

  const resetear = () => {
    setRawC1(null);
    setRawC2(null);
    setFechaReporte("");
    setSeleccionados(new Set());
    setComentarios({});
    setComentariosAcreedor({});
  };

  return (
    <div>
      {/* ─── BARRA SUPERIOR: CARGA DE ARCHIVOS ─── */}
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Archivo C1
          </div>
          <input
            ref={fileInputC1Ref}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e, setRawC1)}
          />
          <button
            onClick={() => fileInputC1Ref.current?.click()}
            style={{
              ...btnUpload,
              background: rawC1 ? "#1DB954" : "#1877F2",
            }}
          >
            {rawC1 ? `✓ C1 — ${rawC1.rows.length} cuentas` : "Subir C1"}
          </button>
        </div>

        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Archivo C2
          </div>
          <input
            ref={fileInputC2Ref}
            type="file"
            accept=".xlsx,.xls"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e, setRawC2)}
          />
          <button
            onClick={() => fileInputC2Ref.current?.click()}
            style={{
              ...btnUpload,
              background: rawC2 ? "#1DB954" : "#6366F1",
            }}
          >
            {rawC2 ? `✓ C2 — ${rawC2.rows.length} cuentas` : "Subir C2"}
          </button>
        </div>

        <div
          style={{ width: 1, background: "#f0f0f0", alignSelf: "stretch" }}
        />

        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Fecha del reporte
          </div>
          <input
            type="text"
            placeholder="Ej: 10/02/2026"
            value={fechaReporte}
            onChange={(e) => setFechaReporte(e.target.value)}
            style={{ ...inputStyle, width: 140 }}
          />
        </div>

        {tieneData && (
          <>
            <div
              style={{ width: 1, background: "#f0f0f0", alignSelf: "stretch" }}
            />
            <div
              style={{
                background: "#F0F2F5",
                borderRadius: 10,
                padding: "10px 16px",
                fontSize: 12,
                color: "#555",
                fontWeight: 600,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "#aaa",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 4,
                }}
              >
                Consolidado
              </div>
              <div>{consolidado.length} cuentas con saldo</div>
              <div>
                <span style={{ color: "#E8335A" }}>
                  {deudores.length} deudores
                </span>
                {" / "}
                <span style={{ color: "#1DB954" }}>
                  {acreedores.length} acreedores
                </span>
              </div>
            </div>
          </>
        )}

        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          {tieneData && (
            <button
              onClick={resetear}
              style={{
                padding: "8px 16px",
                background: "#fff",
                border: "1px solid #E8335A",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                fontFamily: "Montserrat, sans-serif",
                color: "#E8335A",
                cursor: "pointer",
              }}
            >
              Limpiar
            </button>
          )}
          <button
            onClick={() => setShowUnifModal(true)}
            style={{
              padding: "8px 16px",
              background: "#fff",
              border: "1px solid #6366F1",
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "Montserrat, sans-serif",
              color: "#6366F1",
              cursor: "pointer",
            }}
          >
            Unificaciones ({unificaciones.length})
          </button>
        </div>
      </div>

      {/* ─── MODAL UNIFICACIONES ─── */}
      {showUnifModal && (
        <div className="modal-overlay" onClick={() => setShowUnifModal(false)}>
          <div
            className="modal"
            style={{ width: 500, textAlign: "left" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#1a1a2e",
                marginBottom: 6,
              }}
            >
              Unificaciones de cuentas corrientes
            </div>
            <div
              style={{
                fontSize: 12,
                color: "#888",
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Agrupá varias cuentas corrientes bajo un mismo nombre. Se guardan
              automáticamente para la próxima vez.
            </div>

            {unificaciones.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                {unificaciones.map((u, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 12px",
                      background: "#f8f9fa",
                      borderRadius: 8,
                      marginBottom: 6,
                      fontSize: 12,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#888", marginBottom: 2 }}>
                        {u.origenes.join(" + ")}
                      </div>
                      <div style={{ fontWeight: 700, color: "#1a1a2e" }}>
                        → {u.destino}
                      </div>
                    </div>
                    <button
                      onClick={() => eliminarUnif(idx)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#E8335A",
                        cursor: "pointer",
                        fontSize: 16,
                        padding: 4,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                borderTop: "1px solid #f0f0f0",
                paddingTop: 16,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                Nueva unificación
              </div>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#555",
                  marginBottom: 6,
                }}
              >
                Cuentas a unificar:
              </div>
              {unifOrigen.map((val, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    gap: 6,
                    marginBottom: 6,
                    alignItems: "center",
                  }}
                >
                  <input
                    type="text"
                    value={val}
                    onChange={(e) => actualizarOrigenUnif(idx, e.target.value)}
                    placeholder="Nombre exacto de la CC"
                    list="nombres-cc-list"
                    style={{ ...inputStyle, flex: 1, fontSize: 12 }}
                  />
                  {unifOrigen.length > 1 && (
                    <button
                      onClick={() => quitarOrigenUnif(idx)}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#E8335A",
                        cursor: "pointer",
                        fontSize: 18,
                        padding: 2,
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
              <datalist id="nombres-cc-list">
                {nombresDisponibles.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
              <button
                onClick={agregarOrigenUnif}
                style={{
                  background: "none",
                  border: "1px dashed #ccc",
                  borderRadius: 6,
                  padding: "4px 12px",
                  fontSize: 11,
                  color: "#888",
                  cursor: "pointer",
                  fontFamily: "Montserrat, sans-serif",
                  marginBottom: 12,
                }}
              >
                + Agregar cuenta
              </button>

              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#555",
                  marginBottom: 6,
                }}
              >
                Nombre unificado:
              </div>
              <input
                type="text"
                value={unifDestino}
                onChange={(e) => setUnifDestino(e.target.value)}
                placeholder="Nombre con el que aparecerá"
                style={{ ...inputStyle, width: "100%", fontSize: 12 }}
              />
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button
                onClick={guardarUnif}
                disabled={
                  unifOrigen.filter((o) => o.trim()).length < 2 ||
                  !unifDestino.trim()
                }
                className="modal-btn"
                style={{ flex: 1 }}
              >
                Guardar unificación
              </button>
              <button
                onClick={() => setShowUnifModal(false)}
                className="modal-btn-cancel"
                style={{ flex: 1 }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SIN DATA: ESTADO VACÍO ─── */}
      {!tieneData && (
        <div
          style={{
            border: "2px dashed #d0d5dd",
            borderRadius: 16,
            padding: "64px 40px",
            textAlign: "center",
            background: "#fff",
            maxWidth: 520,
            margin: "60px auto",
          }}
        >
          <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#1a1a2e",
              marginBottom: 8,
            }}
          >
            Saldos CC — Clientes de la casa
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#888",
              marginBottom: 24,
              lineHeight: 1.6,
            }}
          >
            Subí los archivos de saldos de Cuenta 1 y Cuenta 2 para generar el
            informe consolidado.
          </div>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => fileInputC1Ref.current?.click()}
              style={btnUpload}
            >
              Subir C1
            </button>
            <button
              onClick={() => fileInputC2Ref.current?.click()}
              style={{ ...btnUpload, background: "#6366F1" }}
            >
              Subir C2
            </button>
          </div>
        </div>
      )}

      {/* ─── CON DATA: TABLAS ─── */}
      {tieneData && (
        <div
          style={{
            background: "#fff",
            borderRadius: 14,
            padding: 28,
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
            fontFamily: "Arial, sans-serif",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 20,
              paddingBottom: 16,
              borderBottom: "2px solid #f0f0f0",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>
              Vista previa del informe
            </div>
            <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>
              {seleccionados.size} clientes incluidos en el mail
            </div>
          </div>

          <p
            style={{
              fontSize: 14,
              color: "#222",
              marginBottom: 10,
              lineHeight: 1.7,
            }}
          >
            Buenas tardes ¿Cómo están?
            <br />
            Se presenta un nuevo informe consolidado de saldos, elaborado a
            partir de la conciliación entre el Sistema 1 y el Sistema 2 sobre
            clientes de la casa junto con comentarios que aportan información al
            respecto
          </p>
          <p
            style={{
              fontSize: 14,
              color: "#222",
              marginBottom: 16,
              lineHeight: 1.7,
            }}
          >
            Reporte que se genera cada 15/20 días para su manejo y control
          </p>
          <p
            style={{
              fontSize: 14,
              color: "#222",
              marginBottom: 20,
              lineHeight: 1.7,
            }}
          >
            El saldo deudor al {fechaReporte || "—"} es de{" "}
            <strong>{fmtSaldoAR(totalDeudorSel)}</strong>
          </p>

          {/* ─── TABLA DEUDORES ─── */}
          {deudores.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#E8335A",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Saldos deudores ({deudoresSeleccionados.length}/
                  {deudores.length})
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => seleccionarTodos(deudores)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 11,
                      color: "#1877F2",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    Seleccionar todos
                  </button>
                  <button
                    onClick={() => deseleccionarTodos(deudores)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 11,
                      color: "#888",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    Deseleccionar
                  </button>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    borderCollapse: "collapse",
                    width: "100%",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F8F9FA" }}>
                      <th
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          width: 36,
                        }}
                      >
                        ✓
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Cuenta corriente
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "right",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          width: 160,
                        }}
                      >
                        Saldo
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          minWidth: 200,
                        }}
                      >
                        Comentarios
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {deudores.map((r) => (
                      <tr
                        key={r.nombre}
                        style={{
                          borderBottom: "1px solid #f5f5f5",
                          background: seleccionados.has(r.nombre)
                            ? "#f0fff0"
                            : "#fff",
                          opacity: seleccionados.has(r.nombre) ? 1 : 0.5,
                        }}
                      >
                        <td
                          style={{ padding: "6px 10px", textAlign: "center" }}
                        >
                          <input
                            type="checkbox"
                            checked={seleccionados.has(r.nombre)}
                            onChange={() => toggleSeleccion(r.nombre)}
                            className="cb"
                          />
                        </td>
                        <td
                          style={{
                            padding: "6px 14px",
                            fontWeight: 600,
                            color: "#1a1a2e",
                          }}
                        >
                          {r.nombre}
                        </td>
                        <td
                          style={{
                            padding: "6px 14px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#E8335A",
                          }}
                        >
                          {fmtSaldoAR(r.saldo)}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            value={comentarios[r.nombre] || ""}
                            onChange={(e) =>
                              actualizarComentario(r.nombre, e.target.value)
                            }
                            placeholder="Agregar comentario..."
                            style={{
                              width: "100%",
                              padding: "5px 8px",
                              border: "1px solid #eee",
                              borderRadius: 6,
                              fontSize: 12,
                              fontFamily: "Montserrat, sans-serif",
                              color: "#444",
                              outline: "none",
                              background: seleccionados.has(r.nombre)
                                ? "#fff"
                                : "#f8f8f8",
                            }}
                            disabled={!seleccionados.has(r.nombre)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {deudoresSeleccionados.length > 0 && (
                    <tfoot>
                      <tr
                        style={{
                          background: "#F8F9FA",
                          borderTop: "2px solid #eee",
                        }}
                      >
                        <td />
                        <td
                          style={{
                            padding: "8px 14px",
                            fontWeight: 700,
                            fontSize: 13,
                          }}
                        >
                          Total deudor
                        </td>
                        <td
                          style={{
                            padding: "8px 14px",
                            textAlign: "right",
                            fontWeight: 700,
                            fontSize: 14,
                            color: "#E8335A",
                          }}
                        >
                          {fmtSaldoAR(totalDeudorSel)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          <p
            style={{
              fontSize: 14,
              color: "#222",
              marginBottom: 16,
              lineHeight: 1.7,
            }}
          >
            A continuación, detalle de quienes cuentan con saldo a favor,
            considerando que también puede ser de utilidad al momento de cerrar
            operaciones
          </p>

          {/* ─── TABLA ACREEDORES ─── */}
          {acreedores.length > 0 && (
            <div style={{ marginBottom: 32 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1DB954",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                  }}
                >
                  Saldos a favor ({acreedoresSeleccionados.length}/
                  {acreedores.length})
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => seleccionarTodos(acreedores)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 11,
                      color: "#1877F2",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    Seleccionar todos
                  </button>
                  <button
                    onClick={() => deseleccionarTodos(acreedores)}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 11,
                      color: "#888",
                      cursor: "pointer",
                      fontWeight: 600,
                      fontFamily: "Montserrat, sans-serif",
                    }}
                  >
                    Deseleccionar
                  </button>
                </div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table
                  style={{
                    borderCollapse: "collapse",
                    width: "100%",
                    fontSize: 13,
                  }}
                >
                  <thead>
                    <tr style={{ background: "#F8F9FA" }}>
                      <th
                        style={{
                          padding: "8px 10px",
                          textAlign: "center",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          width: 36,
                        }}
                      >
                        ✓
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Cuenta corriente
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "right",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          width: 160,
                        }}
                      >
                        Saldo
                      </th>
                      <th
                        style={{
                          padding: "8px 14px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#555",
                          borderBottom: "1px solid #eee",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                          minWidth: 200,
                        }}
                      >
                        Comentarios
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {acreedores.map((r) => (
                      <tr
                        key={r.nombre}
                        style={{
                          borderBottom: "1px solid #f5f5f5",
                          background: seleccionados.has(r.nombre)
                            ? "#f0fff8"
                            : "#fff",
                          opacity: seleccionados.has(r.nombre) ? 1 : 0.5,
                        }}
                      >
                        <td
                          style={{ padding: "6px 10px", textAlign: "center" }}
                        >
                          <input
                            type="checkbox"
                            checked={seleccionados.has(r.nombre)}
                            onChange={() => toggleSeleccion(r.nombre)}
                            className="cb"
                          />
                        </td>
                        <td
                          style={{
                            padding: "6px 14px",
                            fontWeight: 600,
                            color: "#1a1a2e",
                          }}
                        >
                          {r.nombre}
                        </td>
                        <td
                          style={{
                            padding: "6px 14px",
                            textAlign: "right",
                            fontWeight: 700,
                            color: "#1DB954",
                          }}
                        >
                          {fmtSaldoAR(r.saldo)}
                        </td>
                        <td style={{ padding: "6px 10px" }}>
                          <input
                            type="text"
                            value={comentariosAcreedor[r.nombre] || ""}
                            onChange={(e) =>
                              actualizarComentarioAcreedor(r.nombre, e.target.value)
                            }
                            placeholder="Agregar comentario..."
                            style={{
                              width: "100%",
                              padding: "5px 8px",
                              border: "1px solid #eee",
                              borderRadius: 6,
                              fontSize: 12,
                              fontFamily: "Montserrat, sans-serif",
                              color: "#444",
                              outline: "none",
                              background: seleccionados.has(r.nombre)
                                ? "#fff"
                                : "#f8f8f8",
                            }}
                            disabled={!seleccionados.has(r.nombre)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {acreedoresSeleccionados.length > 0 && (
                    <tfoot>
                      <tr
                        style={{
                          background: "#F8F9FA",
                          borderTop: "2px solid #eee",
                        }}
                      >
                        <td />
                        <td
                          style={{
                            padding: "8px 14px",
                            fontWeight: 700,
                            fontSize: 13,
                          }}
                        >
                          Total a favor
                        </td>
                        <td
                          style={{
                            padding: "8px 14px",
                            textAlign: "right",
                            fontWeight: 700,
                            fontSize: 14,
                            color: "#1DB954",
                          }}
                        >
                          {fmtSaldoAR(totalAcreedorSel)}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          )}

          <p
            style={{
              fontSize: 14,
              color: "#222",
              marginBottom: 4,
              lineHeight: 1.7,
            }}
          >
            Cualquier duda o consulta, estoy a disposición
          </p>
          <p style={{ fontSize: 14, color: "#888", marginTop: 20 }}>
            Luciano Goizueta
            <br />
            Administración - Consignataria Galarraga
            <br />
            Tel: 2268 - 421738 / Cel: 2268 - 631482
            <br />
            <span style={{ color: "#1877F2" }}>
              info@consignatariagalarraga.com
            </span>
          </p>

          <div
            style={{
              marginTop: 24,
              paddingTop: 20,
              borderTop: "1px solid #f0f0f0",
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <button
              onClick={copiarMail}
              disabled={seleccionados.size === 0}
              style={{
                padding: "10px 28px",
                background:
                  seleccionados.size === 0
                    ? "#ccc"
                    : copiado
                    ? "#1DB954"
                    : "#1877F2",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Montserrat, sans-serif",
                cursor: seleccionados.size === 0 ? "not-allowed" : "pointer",
                transition: "background 0.2s",
              }}
            >
              {copiado
                ? "¡Copiado al portapapeles!"
                : seleccionados.size === 0
                ? "Seleccioná al menos un cliente"
                : "Copiar mail listo para pegar en Gmail"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// SUB-TAB: ESTADO DE COBROS
// ─────────────────────────────────────────────────────
function SubTabEstadoCobros({ registros, metadata }) {
  const [fechaCorte, setFechaCorte] = useState(lastFridayInputDate);
  const [notas, setNotas] = useState("");
  const [copiado, setCopiado] = useState(false);

  const [saldosSocios, setSaldosSocios] = useState(() => {
    try {
      const saved = localStorage.getItem(SALDOS_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return SOCIOS.map((nombre) => ({
      nombre,
      monto: "",
      tipo: "Saldo Deudor",
    }));
  });

  const actualizarSaldo = (idx, campo, valor) => {
    setSaldosSocios((prev) => {
      const next = prev.map((s, i) =>
        i === idx ? { ...s, [campo]: valor } : s
      );
      localStorage.setItem(SALDOS_KEY, JSON.stringify(next));
      return next;
    });
  };

  const saldosCompletos = saldosSocios.every((s) => s.monto.trim() !== "");
  const numSemana = weekNumberFromDate(fechaCorte);
  const getMeta = (id) => metadata[id] || {};

  const fechaCorteDate = useMemo(() => {
    const d = parseDate(fechaCorte);
    if (d) {
      d.setHours(23, 59, 59, 999);
    }
    return d;
  }, [fechaCorte]);

  const registrosSinExcluidos = useMemo(
    () => registros.filter((r) => !esExcluido(getMeta(r.id).estado)),
    [registros, metadata]
  );

  const registrosPeriodo = useMemo(() => {
    if (!fechaCorteDate) return [];
    return registrosSinExcluidos.filter((r) => {
      const d = parseDate(r.vence);
      return d && d <= fechaCorteDate;
    });
  }, [registrosSinExcluidos, fechaCorteDate]);

  const isCobradoR = useCallback(
    (r) => {
      const m = getMeta(r.id);
      const est = ESTADOS.find(
        (e) => e.label === (m.estado || "Sin información")
      );
      return !!(est && est.esCobrado);
    },
    [metadata]
  );

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const totalGeneral = registrosPeriodo.reduce((s, r) => s + r.importe, 0);

  const { totalCobrado, totalPendiente } = useMemo(() => {
    let cobrado = 0;
    let pendiente = 0;
    registrosPeriodo.forEach((r) => {
      const m = getMeta(r.id);
      const estado = m.estado || "Sin información";
      if (estado === "Pago parcial") {
        const montoParcialNum = Number(m.montoParcial) || 0;
        cobrado += montoParcialNum;
        pendiente += Math.max(0, r.importe - montoParcialNum);
      } else if (isCobradoR(r)) {
        cobrado += r.importe;
      } else {
        pendiente += r.importe;
      }
    });
    return { totalCobrado: cobrado, totalPendiente: pendiente };
  }, [registrosPeriodo, metadata]);

  const pctPendiente =
    totalGeneral > 0 ? Math.round((totalPendiente / totalGeneral) * 100) : 0;
  const pctCobrado =
    totalGeneral > 0 ? Math.round((totalCobrado / totalGeneral) * 100) : 0;

  const sinInfoVencidos = registrosPeriodo.filter((r) => {
    const m = getMeta(r.id);
    if ((m.estado || "Sin información") !== "Sin información") return false;
    const d = parseDate(r.vence);
    if (!d) return false;
    const dc = new Date(d);
    dc.setHours(0, 0, 0, 0);
    return dc < hoy;
  });
  const sinInfoNoVencidos = registrosPeriodo.filter((r) => {
    const m = getMeta(r.id);
    if ((m.estado || "Sin información") !== "Sin información") return false;
    const d = parseDate(r.vence);
    if (!d) return true;
    const dc = new Date(d);
    dc.setHours(0, 0, 0, 0);
    return dc >= hoy;
  });

  const resumenEstado = useMemo(() => {
    const mapa = {};
    registrosPeriodo.forEach((r) => {
      const m = getMeta(r.id);
      const estado = m.estado || "Sin información";
      if (!mapa[estado]) mapa[estado] = { importe: 0, count: 0 };
      mapa[estado].count += 1;
      if (estado === "Pago parcial") {
        mapa[estado].importe += Number(m.montoParcial) || 0;
      } else {
        mapa[estado].importe += r.importe;
      }
    });
    const filas = ESTADOS.filter((e) => e.label !== "Sin información")
      .map((e) => ({
        ...e,
        importe: mapa[e.label]?.importe || 0,
        count: mapa[e.label]?.count || 0,
      }))
      .filter((e) => e.importe > 0);
    if (sinInfoVencidos.length > 0) {
      filas.push({
        label: "Sin información — Vencido",
        bg: "#FFF5F7",
        color: "#E8335A",
        esCobrado: false,
        importe: sinInfoVencidos.reduce((s, r) => s + r.importe, 0),
        count: sinInfoVencidos.length,
      });
    }
    if (sinInfoNoVencidos.length > 0) {
      filas.push({
        label: "Sin información — No vencido",
        bg: "#f0f0f0",
        color: "#888",
        esCobrado: false,
        importe: sinInfoNoVencidos.reduce((s, r) => s + r.importe, 0),
        count: sinInfoNoVencidos.length,
      });
    }
    return filas;
  }, [registrosPeriodo, metadata, sinInfoVencidos, sinInfoNoVencidos]);

  const pivotMora = useMemo(() => {
    if (!fechaCorteDate) return [];
    const mapa = {};
    registrosPeriodo.forEach((r) => {
      const m = getMeta(r.id);
      const estado = m.estado || "Sin información";
      const esCobrado = isCobradoR(r);

      let importePendiente = 0;
      if (estado === "Pago parcial") {
        const montoParcialNum = Number(m.montoParcial) || 0;
        importePendiente = Math.max(0, r.importe - montoParcialNum);
      } else if (!esCobrado) {
        importePendiente = r.importe;
      }

      if (importePendiente <= 0) return;

      const key = r.cuenta || r.descripcion || "-";
      const dv = parseDate(r.vence);
      const mora = dv
        ? Math.round(
            (fechaCorteDate.getTime() - dv.getTime()) / (1000 * 60 * 60 * 24)
          )
        : 0;
      if (!mapa[key])
        mapa[key] = { nombre: key, m30: 0, m60: 0, m60plus: 0, total: 0 };
      if (mora <= 30) mapa[key].m30 += importePendiente;
      else if (mora <= 60) mapa[key].m60 += importePendiente;
      else mapa[key].m60plus += importePendiente;
      mapa[key].total += importePendiente;
    });
    return Object.values(mapa).sort((a, b) => b.total - a.total);
  }, [registrosPeriodo, fechaCorteDate, metadata]);

  const totalMora = useMemo(
    () =>
      pivotMora.reduce(
        (acc, r) => ({
          m30: acc.m30 + r.m30,
          m60: acc.m60 + r.m60,
          m60plus: acc.m60plus + r.m60plus,
          total: acc.total + r.total,
        }),
        { m30: 0, m60: 0, m60plus: 0, total: 0 }
      ),
    [pivotMora]
  );

  const fechaCorteDisplay = fechaCorteDate
    ? fechaCorteDate.toLocaleDateString("es-AR")
    : "-";

  const generarHTML = () => {
    const tdS = `style="padding:8px 12px;border:1px solid #ddd;font-size:13px;"`;
    const tdR = `style="padding:8px 12px;border:1px solid #ddd;font-size:13px;text-align:right;"`;
    const thS = `style="padding:8px 12px;border:1px solid #ddd;font-size:11px;background:#F8F9FA;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;"`;
    const thR = `style="padding:8px 12px;border:1px solid #ddd;font-size:11px;background:#F8F9FA;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;text-align:right;"`;

    const bloqueTexto = `
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-bottom:16px;">
  Buenas tardes, en el presente mail se informa la situación de cobranzas al <strong>${fechaCorteDisplay}</strong>.
</p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-bottom:8px;">
  - El total de negocios a cobrar en el período fue de <strong>${fmtARSFull(
    totalGeneral
  )}</strong> — al día de este informe tenemos sin cobrar <strong>${fmtARSFull(
      totalPendiente
    )}</strong> — lo que representa un <strong>${pctPendiente}%</strong>.
</p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-bottom:24px;">
  - La tasa de cobros en el mismo período fue de <strong>${fmtARSFull(
    totalCobrado
  )}</strong> — lo que representa un <strong>${pctCobrado}%</strong>.
</p>`;

    const filasEstado = resumenEstado
      .filter((e) => e.importe > 0)
      .map((e) => {
        const pct =
          totalGeneral > 0 ? Math.round((e.importe / totalGeneral) * 100) : 0;
        return `<tr><td ${tdS}>${e.label}</td><td ${tdR}>${fmtARSFull(
          e.importe
        )}</td><td ${tdR}>${pct}%</td></tr>`;
      })
      .join("");

    const bloqueResumen = `
<p style="font-family:Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1a2e;margin-bottom:12px;">RESUMEN DE LA SEMANA ${numSemana}:</p>
<table style="border-collapse:collapse;width:420px;margin-bottom:24px;">
  <thead><tr><th ${thS}>Categoría</th><th ${thR}>Monto</th><th ${thR}>%</th></tr></thead>
  <tbody>${filasEstado}</tbody>
  <tfoot><tr>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;">Total a cobrar</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">${fmtARSFull(
      totalGeneral
    )}</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">100%</td>
  </tr></tfoot>
</table>`;

    const filasMora = pivotMora
      .map(
        (r) => `<tr>
      <td ${tdS}>${r.nombre}</td>
      <td ${tdR}>${r.m30 > 0 ? fmtARSFull(r.m30) : ""}</td>
      <td ${tdR}>${r.m60 > 0 ? fmtARSFull(r.m60) : ""}</td>
      <td ${tdR}>${r.m60plus > 0 ? fmtARSFull(r.m60plus) : ""}</td>
      <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;text-align:right;font-weight:700;">${fmtARSFull(
        r.total
      )}</td>
    </tr>`
      )
      .join("");

    const bloqueMora =
      pivotMora.length > 0
        ? `
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-bottom:12px;">A continuación se detalla:</p>
<table style="border-collapse:collapse;width:100%;margin-bottom:24px;">
  <thead><tr>
    <th ${thS}>Cuenta Corriente</th><th ${thR}>&lt;30 días</th>
    <th ${thR}>30 y &lt;60 días</th><th ${thR}>&gt;60 días</th><th ${thR}>Suma total</th>
  </tr></thead>
  <tbody>${filasMora}</tbody>
  <tfoot><tr>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;">Suma total</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">${fmtARSFull(
      totalMora.m30
    )}</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">${fmtARSFull(
      totalMora.m60
    )}</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">${fmtARSFull(
      totalMora.m60plus
    )}</td>
    <td style="padding:8px 12px;border:1px solid #ddd;font-size:13px;font-weight:700;text-align:right;">${fmtARSFull(
      totalMora.total
    )}</td>
  </tr></tfoot>
</table>`
        : "";

    const bloqueNotas = notas.trim()
      ? `
<p style="font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#222;margin-bottom:8px;">Seguimiento Cobranzas:</p>
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;white-space:pre-line;margin-bottom:24px;">${notas.trim()}</p>`
      : "";

    const filasSaldos = saldosSocios
      .map(
        (s) =>
          `<tr><td ${tdS}><strong>${s.nombre}</strong></td><td ${tdR}>${
            s.monto
              ? fmtARSFull(Number(String(s.monto).replace(/\D/g, "")))
              : "-"
          } - ${s.tipo}</td></tr>`
      )
      .join("");

    const bloqueSaldos = `
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-bottom:12px;">Por último, detalle de los saldos de las cuentas <strong>SOCIOS</strong> al día de la fecha:</p>
<table style="border-collapse:collapse;width:420px;margin-bottom:24px;">
  <tbody>${filasSaldos}</tbody>
</table>`;

    return `<div style="font-family:Arial,sans-serif;max-width:900px;">
${bloqueTexto}${bloqueMora}${bloqueResumen}${bloqueNotas}${bloqueSaldos}
<p style="font-family:Arial,sans-serif;font-size:14px;color:#222;margin-top:24px;">Saludos,<br/><strong>${
      localStorage.getItem(USER_KEY) || "Galarraga"
    }</strong></p>
</div>`;
  };

  const resetearSaldos = () => {
    const vacios = SOCIOS.map((nombre) => ({
      nombre,
      monto: "",
      tipo: "Saldo Deudor",
    }));
    setSaldosSocios(vacios);
    localStorage.setItem(SALDOS_KEY, JSON.stringify(vacios));
  };

  const copiarAlPortapapeles = async () => {
    if (!saldosCompletos) return;
    const html = generarHTML();
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      setCopiado(true);
      setTimeout(() => {
        setCopiado(false);
        resetearSaldos();
      }, 2500);
    } catch {
      await navigator.clipboard.writeText(html);
      setCopiado(true);
      setTimeout(() => {
        setCopiado(false);
        resetearSaldos();
      }, 2500);
    }
  };

  const inputStyle = {
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "Montserrat, sans-serif",
    outline: "none",
    color: "#1a1a2e",
    background: "#fff",
  };
  const thStyle = {
    padding: "9px 14px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#555",
    borderBottom: "1px solid #eee",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    background: "#F8F9FA",
  };
  const tdStyle = {
    padding: "9px 14px",
    borderBottom: "1px solid #f5f5f5",
    fontSize: 13,
  };

  return (
    <div>
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: "16px 20px",
          marginBottom: 20,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Fecha de corte
          </div>
          <input
            type="date"
            value={fechaCorte}
            onChange={(e) => setFechaCorte(e.target.value)}
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: "#aaa", marginTop: 4 }}>
            Semana {numSemana} — Los datos se calculan hasta esta fecha
          </div>
        </div>
        <div
          style={{ width: 1, background: "#f0f0f0", alignSelf: "stretch" }}
        />
        <div
          style={{
            background: "#F0F2F5",
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 12,
            color: "#555",
            fontWeight: 600,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "#aaa",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 4,
            }}
          >
            Período
          </div>
          <div>{registrosPeriodo.length} comprobantes</div>
          <div style={{ color: "#1877F2", fontWeight: 700 }}>
            {fmtARSFull(totalGeneral)}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={copiarAlPortapapeles}
            disabled={!saldosCompletos}
            style={{
              padding: "10px 24px",
              background: !saldosCompletos
                ? "#ccc"
                : copiado
                ? "#1DB954"
                : "#1877F2",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "Montserrat, sans-serif",
              cursor: !saldosCompletos ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {copiado
              ? "¡Copiado!"
              : !saldosCompletos
              ? "Completá los saldos para copiar"
              : "Copiar reporte"}
          </button>
        </div>
      </div>

      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 28,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
            paddingBottom: 16,
            borderBottom: "2px solid #f0f0f0",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>
            Vista previa del reporte
          </div>
          <div style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>
            Semana {numSemana} — al {fechaCorteDisplay}
          </div>
        </div>

        <p
          style={{
            fontSize: 14,
            color: "#222",
            marginBottom: 10,
            lineHeight: 1.7,
          }}
        >
          Buenas tardes, en el presente mail se informa la situación de
          cobranzas al <strong>{fechaCorteDisplay}</strong>.
        </p>
        <p
          style={{
            fontSize: 14,
            color: "#222",
            marginBottom: 8,
            lineHeight: 1.7,
          }}
        >
          - El total de negocios a cobrar en el período fue de{" "}
          <strong>{fmtARSFull(totalGeneral)}</strong> — al día de este informe
          tenemos sin cobrar <strong>{fmtARSFull(totalPendiente)}</strong> — lo
          que representa un <strong>{pctPendiente}%</strong>.
        </p>
        <p
          style={{
            fontSize: 14,
            color: "#222",
            marginBottom: 24,
            lineHeight: 1.7,
          }}
        >
          - La tasa de cobros en el mismo período fue de{" "}
          <strong>{fmtARSFull(totalCobrado)}</strong> — lo que representa un{" "}
          <strong>{pctCobrado}%</strong>.
        </p>

        {pivotMora.length > 0 && (
          <>
            <p style={{ fontSize: 14, color: "#222", marginBottom: 8 }}>
              A continuación se detalla:
            </p>
            <div style={{ overflowX: "auto", marginBottom: 28 }}>
              <table
                style={{
                  borderCollapse: "collapse",
                  width: "100%",
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr>
                    <th style={thStyle}>Cuenta Corriente</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      &lt;30 días
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      30 y &lt;60 días
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      &gt;60 días
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      Suma total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pivotMora.map((r) => (
                    <tr
                      key={r.nombre}
                      style={{ borderBottom: "1px solid #f5f5f5" }}
                    >
                      <td style={tdStyle}>{r.nombre}</td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: r.m30 > 0 ? "#1a1a2e" : "#ddd",
                        }}
                      >
                        {r.m30 > 0 ? fmtARSFull(r.m30) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: r.m60 > 0 ? "#E8970C" : "#ddd",
                        }}
                      >
                        {r.m60 > 0 ? fmtARSFull(r.m60) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          color: r.m60plus > 0 ? "#E8335A" : "#ddd",
                        }}
                      >
                        {r.m60plus > 0 ? fmtARSFull(r.m60plus) : "—"}
                      </td>
                      <td
                        style={{
                          ...tdStyle,
                          textAlign: "right",
                          fontWeight: 700,
                        }}
                      >
                        {fmtARSFull(r.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      background: "#F8F9FA",
                      borderTop: "2px solid #eee",
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 700 }}>Suma total</td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 700,
                      }}
                    >
                      {fmtARSFull(totalMora.m30)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#E8970C",
                      }}
                    >
                      {fmtARSFull(totalMora.m60)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#E8335A",
                      }}
                    >
                      {fmtARSFull(totalMora.m60plus)}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        textAlign: "right",
                        fontWeight: 700,
                        color: "#1877F2",
                        fontSize: 14,
                      }}
                    >
                      {fmtARSFull(totalMora.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        <p
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#1a1a2e",
            marginBottom: 12,
          }}
        >
          RESUMEN DE LA SEMANA {numSemana}:
        </p>
        <table
          style={{
            borderCollapse: "collapse",
            width: 420,
            marginBottom: 28,
            fontSize: 13,
          }}
        >
          <thead>
            <tr>
              <th style={thStyle}>Categoría</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Monto</th>
              <th style={{ ...thStyle, textAlign: "right" }}>%</th>
            </tr>
          </thead>
          <tbody>
            {resumenEstado.map((e) => {
              const pct =
                totalGeneral > 0
                  ? Math.round((e.importe / totalGeneral) * 100)
                  : 0;
              return (
                <tr key={e.label} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={tdStyle}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 700,
                        background: e.bg,
                        color: e.color,
                      }}
                    >
                      {e.label}
                    </span>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      textAlign: "right",
                      fontWeight: e.importe > 0 ? 700 : 400,
                      color: e.importe > 0 ? "#1a1a2e" : "#ccc",
                    }}
                  >
                    {fmtARSFull(e.importe)}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#555" }}>
                    {pct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: "#F8F9FA", borderTop: "2px solid #eee" }}>
              <td style={{ ...tdStyle, fontWeight: 700 }}>Total a cobrar</td>
              <td
                style={{
                  ...tdStyle,
                  textAlign: "right",
                  fontWeight: 700,
                  color: "#1877F2",
                  fontSize: 14,
                }}
              >
                {fmtARSFull(totalGeneral)}
              </td>
              <td style={{ ...tdStyle, textAlign: "right", fontWeight: 700 }}>
                100%
              </td>
            </tr>
          </tfoot>
        </table>

        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 1,
              marginBottom: 8,
            }}
          >
            Seguimiento Cobranzas (notas manuales)
          </div>
          <textarea
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder={
              "- Agro Holanda, manda usd la semana que viene.\n- Kubransky paga el lunes.\n..."
            }
            style={{
              width: "100%",
              minHeight: 100,
              padding: "10px 14px",
              border: "1px dashed #d0d5dd",
              borderRadius: 10,
              fontSize: 13,
              fontFamily: "Arial, sans-serif",
              color: "#222",
              outline: "none",
              resize: "vertical",
              background: "#FFFBF0",
              lineHeight: 1.7,
            }}
          />
        </div>

        <div
          style={{
            marginBottom: 24,
            background: !saldosCompletos ? "#FFF5F7" : "#F6FFF9",
            borderRadius: 12,
            padding: 20,
            border: `1px solid ${!saldosCompletos ? "#ffd0d8" : "#b8f0cc"}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#1a1a2e",
                  marginBottom: 2,
                }}
              >
                Saldos cuentas corrientes SOCIOS
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    background: "#E8335A",
                    color: "#fff",
                    padding: "2px 8px",
                    borderRadius: 8,
                  }}
                >
                  OBLIGATORIO
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>
                Estos datos son obligatorios para poder copiar el reporte
              </div>
            </div>
            {saldosCompletos && (
              <span style={{ fontSize: 12, fontWeight: 700, color: "#1DB954" }}>
                ✓ Completo
              </span>
            )}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                <th
                  style={{ ...thStyle, background: "transparent", width: 200 }}
                >
                  Socio
                </th>
                <th style={{ ...thStyle, background: "transparent" }}>Monto</th>
                <th
                  style={{ ...thStyle, background: "transparent", width: 200 }}
                >
                  Tipo de saldo
                </th>
              </tr>
            </thead>
            <tbody>
              {saldosSocios.map((s, i) => (
                <tr
                  key={s.nombre}
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}
                >
                  <td
                    style={{
                      padding: "8px 14px",
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {s.nombre}
                  </td>
                  <td style={{ padding: "8px 14px" }}>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 6 }}
                    >
                      <span
                        style={{ fontSize: 13, fontWeight: 600, color: "#888" }}
                      >
                        $
                      </span>
                      <input
                        type="text"
                        placeholder="Ej: 378000000"
                        value={s.monto}
                        onChange={(e) =>
                          actualizarSaldo(i, "monto", e.target.value)
                        }
                        style={{
                          padding: "6px 10px",
                          border: `1px solid ${
                            !s.monto.trim() ? "#E8335A" : "#e0e0e0"
                          }`,
                          borderRadius: 8,
                          fontSize: 13,
                          fontFamily: "Montserrat, sans-serif",
                          outline: "none",
                          width: 180,
                          background: !s.monto.trim() ? "#FFF5F7" : "#fff",
                        }}
                      />
                    </div>
                  </td>
                  <td style={{ padding: "8px 14px" }}>
                    <select
                      value={s.tipo}
                      onChange={(e) =>
                        actualizarSaldo(i, "tipo", e.target.value)
                      }
                      style={{
                        padding: "6px 10px",
                        border: "1px solid #e0e0e0",
                        borderRadius: 8,
                        fontSize: 13,
                        fontFamily: "Montserrat, sans-serif",
                        outline: "none",
                        background: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      <option value="Saldo Deudor">Saldo Deudor</option>
                      <option value="Saldo a Favor">Saldo a Favor</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p style={{ fontSize: 14, color: "#888", marginTop: 8 }}>
          Saludos,
          <br />
          <strong style={{ color: "#1a1a2e" }}>
            {localStorage.getItem(USER_KEY) || "Galarraga"}
          </strong>
        </p>

        <div
          style={{
            marginTop: 24,
            paddingTop: 20,
            borderTop: "1px solid #f0f0f0",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button
            onClick={copiarAlPortapapeles}
            disabled={!saldosCompletos}
            style={{
              padding: "10px 28px",
              background: !saldosCompletos
                ? "#ccc"
                : copiado
                ? "#1DB954"
                : "#1877F2",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontSize: 13,
              fontWeight: 700,
              fontFamily: "Montserrat, sans-serif",
              cursor: !saldosCompletos ? "not-allowed" : "pointer",
              transition: "background 0.2s",
            }}
          >
            {copiado
              ? "¡Copiado al portapapeles!"
              : !saldosCompletos
              ? "Completá los saldos para copiar"
              : "Copiar reporte listo para pegar en Gmail"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// COMPONENTE PRINCIPAL CON SUB-TABS
// ─────────────────────────────────────────────────────
function TabReporting({ registros, metadata }) {
  const [subTab, setSubTab] = useState("cobros");

  const subTabStyle = (active) => ({
    padding: "8px 20px",
    borderRadius: 9,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "Montserrat, sans-serif",
    background: active ? "#1877F2" : "transparent",
    color: active ? "#fff" : "#888",
    boxShadow: active ? "0 2px 8px rgba(24,119,242,0.3)" : "none",
    transition: "all 0.15s",
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 20,
          background: "#fff",
          borderRadius: 12,
          padding: 4,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          width: "fit-content",
        }}
      >
        <button
          style={subTabStyle(subTab === "cobros")}
          onClick={() => setSubTab("cobros")}
        >
          Estado de cobros
        </button>
        <button
          style={subTabStyle(subTab === "saldos")}
          onClick={() => setSubTab("saldos")}
        >
          Saldos CC clientes de la casa
        </button>
      </div>

      {subTab === "cobros" && (
        <SubTabEstadoCobros registros={registros} metadata={metadata} />
      )}
      {subTab === "saldos" && <SubTabSaldosCC />}
    </div>
  );
}

export default TabReporting;
