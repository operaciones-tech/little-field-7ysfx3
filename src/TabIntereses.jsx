import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { fmtARSFull, todayInputDate } from "./constants";

// ─── utilidades ─────────────────────────────────────────────────────────────

function fmtFecha(dateObj) {
  if (!dateObj) return "—";
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function parseFechaExcel(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    d.setMinutes(d.getMinutes() + d.getTimezoneOffset());
    return d;
  }
  if (typeof v === "string") {
    const p = v.split("/");
    if (p.length === 3) return new Date(+p[2], +p[1] - 1, +p[0]);
  }
  return null;
}

function toDateOnly(d) {
  if (!d) return null;
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function inputToDate(s) {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ─── parser Excel ─────────────────────────────────────────────────────────────

function parsearExcel(buffer) {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  const headerIdx = rows.findIndex((r) =>
    r.some((c) =>
      String(c || "")
        .toLowerCase()
        .includes("debe")
    )
  );
  if (headerIdx < 0)
    throw new Error("No se encontró la columna DEBE en el archivo.");

  const header = rows[headerIdx].map((c) =>
    String(c || "")
      .toLowerCase()
      .trim()
  );
  const iComp = header.findIndex((h) => h.includes("comprobante"));
  const iDesc = header.findIndex((h) => h.includes("descripci"));
  const iNum = header.findIndex(
    (h) =>
      (h.includes("n") && h.includes("mero")) ||
      h === "numero" ||
      h === "número"
  );
  const iVenc = header.findIndex((h) => h.includes("venc"));
  const iDebe = header.findIndex((h) => h === "debe");
  const iHaber = header.findIndex((h) => h === "haber");
  const iSaldo = header.findIndex((h) => h === "saldo");

  let saldoAnterior = 0;
  let fechaSaldoAnterior = null;
  const dataRows = rows
    .slice(headerIdx + 1)
    .filter((r) => r.some((c) => c != null));

  const filaAnterior = dataRows.find((r) => {
    const desc = String(r[iDesc] || "").toLowerCase();
    return desc.includes("saldo anterior") || desc.includes("saldo ini");
  });
  if (filaAnterior) {
    saldoAnterior = parseFloat(filaAnterior[iSaldo]) || 0;
    fechaSaldoAnterior = toDateOnly(parseFechaExcel(filaAnterior[iVenc]));
  }

  const eventos = [];
  for (const r of dataRows) {
    const desc = String(r[iDesc] || "").toLowerCase();
    if (desc.includes("saldo anterior") || desc.includes("saldo ini")) continue;
    const fecha = toDateOnly(parseFechaExcel(r[iVenc]));
    if (!fecha) continue;
    const debe = parseFloat(r[iDebe]) || 0;
    const haber = parseFloat(r[iHaber]) || 0;
    if (debe === 0 && haber === 0) continue;
    eventos.push({
      fecha,
      comprobante: String(r[iComp] || "").trim(),
      descripcion: String(r[iDesc] || "").trim(),
      numero: String(r[iNum] || "").trim(),
      debe,
      haber,
    });
  }

  eventos.sort((a, b) => a.fecha - b.fecha);

  return { saldoAnterior, fechaSaldoAnterior, eventos };
}

// ─── cálculo de tramos con imputación FIFO ───────────────────────────────────

function calcularTramos({
  saldoAnterior,
  fechaSaldoAnterior,
  eventos,
  fechaInicio,
  fechaFin,
  tna,
}) {
  const tasaDiaria = tna / 365;
  const fi = toDateOnly(inputToDate(fechaInicio));
  const ff = toDateOnly(inputToDate(fechaFin));

  let capas = [];
  const fechaOrigen = fechaSaldoAnterior || fi;
  if (saldoAnterior > 0) {
    capas.push({ fecha: toDateOnly(fechaOrigen), monto: saldoAnterior });
  }

  function imputarPago(monto) {
    let restante = monto;
    const nuevasCapas = [];
    for (const capa of capas) {
      if (restante <= 0) {
        nuevasCapas.push(capa);
        continue;
      }
      if (capa.monto <= restante) {
        restante -= capa.monto;
      } else {
        nuevasCapas.push({ ...capa, monto: capa.monto - restante });
        restante = 0;
      }
    }
    capas = nuevasCapas;
  }

  const todosEventos = [...eventos].sort((a, b) => a.fecha - b.fecha);

  // Procesar eventos anteriores al período
  for (const ev of todosEventos) {
    if (ev.fecha >= fi) break;
    if (ev.haber > 0) imputarPago(ev.haber);
    if (ev.debe > 0)
      capas.push({ fecha: toDateOnly(ev.fecha), monto: ev.debe });
  }

  // Agrupar eventos del período por fecha
  const eventosPorFecha = new Map();
  for (const ev of todosEventos) {
    if (ev.fecha < fi || ev.fecha > ff) continue;
    const key = ev.fecha.getTime();
    if (!eventosPorFecha.has(key)) eventosPorFecha.set(key, []);
    eventosPorFecha.get(key).push(ev);
  }

  const fechasCambio = [...eventosPorFecha.keys()]
    .sort((a, b) => a - b)
    .map((k) => ({ fecha: new Date(k), eventos: eventosPorFecha.get(k) }));

  const saldoTotal = () => capas.reduce((s, c) => s + c.monto, 0);
  const interesCapas = (dias) =>
    capas.reduce((s, c) => s + c.monto * tasaDiaria * dias, 0);

  const tramos = [];
  let fechaTramoInicio = new Date(fi);

  for (const momento of fechasCambio) {
    const dias = Math.round((momento.fecha - fechaTramoInicio) / 86400000);
    if (dias > 0) {
      const saldo = saldoTotal();
      tramos.push({
        desde: new Date(fechaTramoInicio),
        hasta: new Date(momento.fecha),
        dias,
        saldo,
        interes: saldo > 0 ? interesCapas(dias) : 0,
      });
    }
    const cobros = momento.eventos.filter((e) => e.haber > 0);
    const deudas = momento.eventos.filter((e) => e.debe > 0);
    for (const ev of cobros) imputarPago(ev.haber);
    for (const ev of deudas)
      capas.push({ fecha: toDateOnly(ev.fecha), monto: ev.debe });

    fechaTramoInicio = new Date(momento.fecha);
  }

  // Último tramo hasta fechaFin
  const diasFinal = Math.round((ff - fechaTramoInicio) / 86400000) + 1;
  if (diasFinal > 0) {
    const saldo = saldoTotal();
    tramos.push({
      desde: new Date(fechaTramoInicio),
      hasta: new Date(ff),
      dias: diasFinal,
      saldo,
      interes: saldo > 0 ? interesCapas(diasFinal) : 0,
    });
  }

  const totalInteres = tramos.reduce((s, t) => s + t.interes, 0);
  const diasConSaldo = tramos
    .filter((t) => t.saldo > 0)
    .reduce((s, t) => s + t.dias, 0);
  const saldoPromedio =
    diasConSaldo > 0
      ? tramos
          .filter((t) => t.saldo > 0)
          .reduce((s, t) => s + t.saldo * t.dias, 0) / diasConSaldo
      : 0;

  return {
    tramos,
    totalInteres,
    diasConSaldo,
    saldoPromedio,
    saldoInicioPeriodo: saldoAnterior,
  };
}

// ─── exportar a Excel ────────────────────────────────────────────────────────

function exportarExcel({
  resultado,
  nombreCliente,
  periodoStr,
  tna,
  tasaDiaria,
}) {
  const nombreMostrar = nombreCliente.trim() || "Cliente";

  // Filas de encabezado con info del cálculo
  const infoRows = [
    ["Cliente", nombreMostrar],
    ["Período", periodoStr],
    ["TNA", `${tna}%`],
    ["Tasa diaria", `${tasaDiaria}%`],
    ["Total a debitar", Math.round(resultado.totalInteres)],
    ["Saldo al inicio", Math.round(resultado.saldoInicioPeriodo)],
    ["Saldo promedio", Math.round(resultado.saldoPromedio)],
    ["Días con saldo", resultado.diasConSaldo],
    [],
  ];

  // Encabezado de tabla
  const header = [
    "#",
    "Desde",
    "Hasta",
    "Días",
    "Saldo",
    "Interés del tramo",
    "Interés acumulado",
  ];

  // Filas de tramos
  let acum = 0;
  const tramoRows = resultado.tramos.map((t, i) => {
    acum += t.interes;
    return [
      i + 1,
      fmtFecha(t.desde),
      fmtFecha(t.hasta),
      t.dias,
      Math.round(t.saldo),
      Math.round(t.interes),
      Math.round(acum),
    ];
  });

  // Fila total
  const totalRow = [
    "TOTAL",
    "",
    "",
    "",
    "",
    Math.round(resultado.totalInteres),
    "",
  ];

  const wsData = [...infoRows, header, ...tramoRows, [], totalRow];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Ancho de columnas
  ws["!cols"] = [
    { wch: 4 }, // #
    { wch: 12 }, // Desde
    { wch: 12 }, // Hasta
    { wch: 6 }, // Días
    { wch: 18 }, // Saldo
    { wch: 18 }, // Interés tramo
    { wch: 18 }, // Interés acumulado
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Intereses");

  const nombreArchivo = `Intereses_${nombreMostrar.replace(
    /\s+/g,
    "_"
  )}_${periodoStr.replace(/\//g, "-").replace(/\s/g, "_")}.xlsx`;
  XLSX.writeFile(wb, nombreArchivo);
}

// ─── componente ──────────────────────────────────────────────────────────────

export default function TabIntereses() {
  const [archivo, setArchivo] = useState(null);
  const [tna, setTna] = useState("48");
  const [fechaInicio, setFechaInicio] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    d.setDate(1);
    return d.toISOString().split("T")[0];
  });
  const [fechaFin, setFechaFin] = useState(todayInputDate());
  const [cargando, setCargando] = useState(false);
  const [nombreCliente, setNombreCliente] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef();

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setCargando(true);
    setError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const datos = parsearExcel(new Uint8Array(ev.target.result));
        setArchivo({ nombre: f.name, datos });
      } catch (err) {
        setError(err.message || "Error al leer el archivo.");
      } finally {
        setCargando(false);
      }
    };
    reader.readAsArrayBuffer(f);
  };

  const resultado = useMemo(() => {
    if (!archivo || !tna || !fechaInicio || !fechaFin) return null;
    const tnaNum = parseFloat(tna) / 100;
    if (isNaN(tnaNum) || tnaNum <= 0) return null;
    try {
      return calcularTramos({
        ...archivo.datos,
        fechaInicio,
        fechaFin,
        tna: tnaNum,
      });
    } catch (err) {
      return null;
    }
  }, [archivo, tna, fechaInicio, fechaFin]);

  const [copiadoCliente, setCopiadoCliente] = useState(false);
  const [copiadoInterno, setCopiadoInterno] = useState(false);

  const nombreMostrar = nombreCliente.trim() || "el cliente";

  const resetear = () => {
    setArchivo(null);
    setTna("48");
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    d.setDate(1);
    setFechaInicio(d.toISOString().split("T")[0]);
    setFechaFin(todayInputDate());
    setError("");
    if (fileRef.current) fileRef.current.value = "";
    setNombreCliente("");
  };

  const periodoStr =
    fechaInicio && fechaFin
      ? `${fmtFecha(inputToDate(fechaInicio))} al ${fmtFecha(
          inputToDate(fechaFin)
        )}`
      : "—";

  const tasaDiaria = tna
    ? ((parseFloat(tna) / 100 / 365) * 100).toFixed(4)
    : "—";

  const copiarMensajeCliente = async () => {
    if (!resultado) return;
    const monto = fmtARSFull(Math.round(resultado.totalInteres));
    const texto = `Estimado/a,\n\nLe informamos que por el saldo mantenido en cuenta corriente durante el período ${periodoStr} se generaron intereses por un total de *${monto}*.\n\nEste importe será registrado como cargo en su cuenta. Ante cualquier consulta, no dude en comunicarse.\n\nConsignataria Galarraga`;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {}
    setCopiadoCliente(true);
    setTimeout(() => setCopiadoCliente(false), 2500);
  };

  const copiarMensajeInterno = async () => {
    if (!resultado) return;
    const monto = fmtARSFull(Math.round(resultado.totalInteres));
    const texto = `📊 *Liquidación de intereses — ${nombreMostrar}*\n\nPeríodo: ${periodoStr}\nTNA aplicada: ${tna}%\nSaldo promedio: ${fmtARSFull(
      Math.round(resultado.saldoPromedio)
    )}\nDías con saldo: ${
      resultado.diasConSaldo
    }\n\n*Total a cargar en CC: ${monto}*\n\nPendiente registrar en cuenta corriente del cliente.`;
    try {
      await navigator.clipboard.writeText(texto);
    } catch {}
    setCopiadoInterno(true);
    setTimeout(() => setCopiadoInterno(false), 2500);
  };

  const handleExportar = () => {
    if (!resultado) return;
    exportarExcel({ resultado, nombreCliente, periodoStr, tna, tasaDiaria });
  };

  // ─── estilos ────────────────────────────────────────────────────────────────
  const card = {
    background: "#fff",
    borderRadius: 14,
    padding: "20px 24px",
    boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
    border: "1px solid #eee",
  };
  const label = {
    fontSize: 11,
    fontWeight: 700,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
    display: "block",
  };
  const input = {
    padding: "9px 12px",
    border: "1.5px solid #e0e0e0",
    borderRadius: 9,
    fontSize: 14,
    fontFamily: "Montserrat, sans-serif",
    outline: "none",
    color: "#1a1a2e",
    background: "#fff",
    width: "100%",
    boxSizing: "border-box",
  };
  const thS = {
    padding: "10px 14px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    color: "#555",
    borderBottom: "2px solid #eee",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    whiteSpace: "nowrap",
    background: "#F8F9FA",
  };
  const tdS = {
    padding: "9px 14px",
    borderBottom: "1px solid #f5f5f5",
    fontSize: 13,
    color: "#222",
  };
  const tdR = {
    ...tdS,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  };

  return (
    <div style={{ padding: "24px 0", maxWidth: 960, margin: "0 auto" }}>
      {/* ── Configuración ── */}
      <div style={{ ...card, marginBottom: 20 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: "#1a1a2e",
            marginBottom: 18,
          }}
        >
          📊 Calculadora de Intereses
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={label}>Nombre del cliente</span>
          <input
            style={{ ...input, maxWidth: 340 }}
            type="text"
            placeholder="Ej: Barlovento SRL"
            value={nombreCliente}
            onChange={(e) => setNombreCliente(e.target.value)}
          />
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr",
            gap: 16,
            alignItems: "end",
          }}
        >
          <div>
            <span style={label}>Archivo Excel (estado de cuenta)</span>
            <div
              onClick={() => fileRef.current?.click()}
              style={{
                padding: "9px 14px",
                border: "1.5px dashed #1877F2",
                borderRadius: 9,
                fontSize: 13,
                color: archivo ? "#1a1a2e" : "#1877F2",
                cursor: "pointer",
                background: archivo ? "#F0F6FF" : "#fff",
                fontFamily: "Montserrat, sans-serif",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cargando
                ? "Cargando..."
                : archivo
                ? `✅ ${archivo.nombre}`
                : "📂 Seleccionar archivo..."}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleFile}
              style={{ display: "none" }}
            />
          </div>

          <div>
            <span style={label}>Desde</span>
            <input
              style={input}
              type="date"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
          </div>

          <div>
            <span style={label}>Hasta</span>
            <input
              style={input}
              type="date"
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
          </div>

          <div>
            <span style={label}>TNA (%)</span>
            <div style={{ position: "relative" }}>
              <input
                style={{ ...input, paddingRight: 28 }}
                type="number"
                min="0"
                max="999"
                step="0.5"
                value={tna}
                onChange={(e) => setTna(e.target.value)}
                placeholder="48"
              />
              <span
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#999",
                  fontSize: 13,
                }}
              >
                %
              </span>
            </div>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 14,
              padding: "10px 14px",
              background: "#FFF0F3",
              border: "1px solid #E8335A",
              borderRadius: 8,
              color: "#E8335A",
              fontSize: 13,
            }}
          >
            ⚠️ {error}
          </div>
        )}
      </div>

      {/* ── Sin archivo ── */}
      {!archivo && !cargando && (
        <div
          style={{
            ...card,
            textAlign: "center",
            padding: "48px 24px",
            color: "#aaa",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 6,
              color: "#bbb",
            }}
          >
            Cargá el estado de cuenta del cliente
          </div>
          <div style={{ fontSize: 13 }}>
            Archivo Excel exportado del sistema de gestión
          </div>
        </div>
      )}

      {/* ── Resultado ── */}
      {resultado && archivo && (
        <>
          {/* KPIs */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 14,
              marginBottom: 20,
            }}
          >
            <div style={{ ...card, borderTop: "3px solid #E8335A" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Total a debitar
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#E8335A",
                  letterSpacing: -0.5,
                }}
              >
                {fmtARSFull(Math.round(resultado.totalInteres))}
              </div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                Interés acumulado
              </div>
            </div>

            <div style={{ ...card, borderTop: "3px solid #1877F2" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Saldo al inicio
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#1877F2",
                  letterSpacing: -0.5,
                }}
              >
                {fmtARSFull(Math.round(resultado.saldoInicioPeriodo))}
              </div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                {fechaInicio ? fmtFecha(inputToDate(fechaInicio)) : "—"}
              </div>
            </div>

            <div style={{ ...card, borderTop: "3px solid #1DB954" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Saldo promedio
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#1DB954",
                  letterSpacing: -0.5,
                }}
              >
                {fmtARSFull(Math.round(resultado.saldoPromedio))}
              </div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                Ponderado por días
              </div>
            </div>

            <div style={{ ...card, borderTop: "3px solid #E8970C" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  marginBottom: 8,
                }}
              >
                Tasa diaria
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  color: "#E8970C",
                  letterSpacing: -0.5,
                }}
              >
                {tasaDiaria}%
              </div>
              <div style={{ fontSize: 11, color: "#aaa", marginTop: 4 }}>
                TNA {tna}% · {resultado.diasConSaldo} días con saldo
              </div>
            </div>
          </div>

          {/* Tabla de tramos */}
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #f0f0f0",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>
                Detalle por tramo
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>
                {resultado.tramos.length} tramos · TNA {tna}% · Tasa diaria{" "}
                {tasaDiaria}%
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thS}>#</th>
                    <th style={thS}>Desde</th>
                    <th style={thS}>Hasta</th>
                    <th style={{ ...thS, textAlign: "center" }}>Días</th>
                    <th style={{ ...thS, textAlign: "right" }}>Saldo</th>
                    <th style={{ ...thS, textAlign: "right" }}>
                      Interés del tramo
                    </th>
                    <th style={{ ...thS, textAlign: "right" }}>
                      Interés acumulado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.tramos.map((t, i) => {
                    const acum = resultado.tramos
                      .slice(0, i + 1)
                      .reduce((s, x) => s + x.interes, 0);
                    const esSaldoNeg = t.saldo <= 0;
                    return (
                      <tr
                        key={i}
                        style={{
                          background: esSaldoNeg
                            ? "#FAFAFA"
                            : i % 2 === 0
                            ? "#fff"
                            : "#FAFFFE",
                        }}
                      >
                        <td style={{ ...tdS, color: "#bbb", fontSize: 11 }}>
                          {i + 1}
                        </td>
                        <td style={tdS}>{fmtFecha(t.desde)}</td>
                        <td style={tdS}>{fmtFecha(t.hasta)}</td>
                        <td style={{ ...tdS, textAlign: "center" }}>
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 20,
                              background: t.dias >= 10 ? "#FFF3E0" : "#F0F6FF",
                              color: t.dias >= 10 ? "#E8970C" : "#1877F2",
                              fontWeight: 700,
                              fontSize: 12,
                            }}
                          >
                            {t.dias}
                          </span>
                        </td>
                        <td
                          style={{
                            ...tdR,
                            color: esSaldoNeg ? "#aaa" : "#1a1a2e",
                          }}
                        >
                          {esSaldoNeg ? (
                            <span style={{ color: "#1DB954" }}>A favor</span>
                          ) : (
                            fmtARSFull(Math.round(t.saldo))
                          )}
                        </td>
                        <td
                          style={{
                            ...tdR,
                            color: esSaldoNeg ? "#aaa" : "#E8335A",
                            fontWeight: t.interes > 0 ? 600 : 400,
                          }}
                        >
                          {t.interes > 0
                            ? fmtARSFull(Math.round(t.interes))
                            : "—"}
                        </td>
                        <td
                          style={{ ...tdR, color: "#1a1a2e", fontWeight: 600 }}
                        >
                          {fmtARSFull(Math.round(acum))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr
                    style={{
                      background: "#F8F9FA",
                      borderTop: "2px solid #eee",
                    }}
                  >
                    <td
                      colSpan={5}
                      style={{ ...tdS, fontWeight: 700, color: "#555" }}
                    >
                      TOTAL
                    </td>
                    <td
                      style={{
                        ...tdR,
                        fontWeight: 800,
                        color: "#E8335A",
                        fontSize: 15,
                        borderBottom: "1px solid #f5f5f5",
                      }}
                    >
                      {fmtARSFull(Math.round(resultado.totalInteres))}
                    </td>
                    <td style={tdS} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Acciones ── */}
          <div
            style={{
              display: "flex",
              gap: 12,
              marginTop: 20,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={resetear}
              style={{
                padding: "11px 20px",
                background: "#F0F2F5",
                color: "#555",
                border: "1.5px solid #ddd",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Montserrat, sans-serif",
                cursor: "pointer",
              }}
            >
              🔄 Nuevo cálculo
            </button>

            <button
              onClick={copiarMensajeCliente}
              style={{
                padding: "11px 20px",
                background: copiadoCliente ? "#1DB954" : "#1877F2",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Montserrat, sans-serif",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {copiadoCliente ? "✅ ¡Copiado!" : "📲 WhatsApp al cliente"}
            </button>

            <button
              onClick={copiarMensajeInterno}
              style={{
                padding: "11px 20px",
                background: copiadoInterno ? "#1DB954" : "#1a1a2e",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Montserrat, sans-serif",
                cursor: "pointer",
                transition: "background 0.2s",
              }}
            >
              {copiadoInterno ? "✅ ¡Copiado!" : "📋 WhatsApp interno"}
            </button>

            <button
              onClick={handleExportar}
              style={{
                padding: "11px 20px",
                background: "#1DB954",
                color: "#fff",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 700,
                fontFamily: "Montserrat, sans-serif",
                cursor: "pointer",
              }}
            >
              📥 Exportar a Excel
            </button>
          </div>

          <div
            style={{
              marginTop: 16,
              padding: "16px 20px",
              background: "#FFFBF0",
              border: "1.5px solid #E8970C",
              borderRadius: 12,
              borderLeft: "4px solid #E8970C",
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#E8970C",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              📝 Instrucción para contabilidad
            </div>
            <div style={{ fontSize: 13, color: "#1a1a2e", lineHeight: 1.6 }}>
              Registrar en la cuenta corriente de{" "}
              <strong>{nombreMostrar}</strong> un nuevo cargo por{" "}
              <strong style={{ color: "#E8335A" }}>
                {fmtARSFull(Math.round(resultado.totalInteres))}
              </strong>{" "}
              en concepto de <strong>intereses por financiación</strong> —
              período {periodoStr} — TNA {tna}%.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
