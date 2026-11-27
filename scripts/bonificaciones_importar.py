"""Lee el Excel sin modificarlo. La salida contiene datos privados: no publicarla en GitHub."""
import argparse
import collections
import datetime as dt
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
import unicodedata
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
HEADERS = {
    'Comprobantes': dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', [
        'Cliente', 'Nombre comercial', 'Producto facturado', 'Fecha emisión', 'Comprobante', 'Renglón', 'Código',
        'Cantidad', 'Unidad facturada', 'Unitario antes de bonif. s/IVA', 'Bonif. registrada', 'IVA facturado',
        'Neto cobrado / un.', 'Lista vigente / un.', 'Bonif. efectiva', 'Comparabilidad', 'Lista estimada / un.',
        'Est. histórica', 'Respaldo de lista', 'Último cambio de lista', 'Generado en Dubix', 'Subtotal con IVA',
        'Nombre en inventario', 'Unidad en ficha', 'Observaciones', 'Documento asociado'])),
    'Listas de precios': dict(zip('ABCDEFG', ['Código', 'Producto Dubix', 'Unidad', 'Lista actual s/IVA',
        'Lista actual c/IVA', 'IVA', 'Último cambio de lista']))
}

def key(value):
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', str(value or '')) if not unicodedata.combining(c)).lower().split())

def number(value):
    try:
        n = Decimal(str(value).replace(',', '.').replace('%', ''))
        return n if n.is_finite() else None
    except (InvalidOperation, ValueError):
        return None

def date(value):
    n = number(value)
    return dt.datetime(1899, 12, 30) + dt.timedelta(days=float(n)) if n is not None else None

def unit(value):
    return {'kilogramos': 'kg', 'kilogramo': 'kg', 'unidad': 'u', 'unidades': 'u', 'un.': 'u'}.get(key(value), key(value))

def sheets(path):
    with zipfile.ZipFile(path) as z:
        strings = [''.join(e.itertext()) for e in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', NS)] if 'xl/sharedStrings.xml' in z.namelist() else []
        rel = {e.attrib['Id']: e.attrib['Target'] for e in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
        result = {}
        for sheet in ET.fromstring(z.read('xl/workbook.xml')).find('s:sheets', NS):
            target = rel[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(z.read(target)).findall('s:sheetData/s:row', NS):
                if int(row.attrib['r']) < 5:
                    continue
                d = {'fila_excel': int(row.attrib['r'])}
                for cell in row:
                    v, inline = cell.find('s:v', NS), cell.find('s:is', NS)
                    value = v.text if v is not None else ''.join(inline.itertext()) if inline is not None else None
                    if cell.attrib.get('t') == 's': value = strings[int(value)]
                    d[''.join(c for c in cell.attrib['r'] if c.isalpha())] = value
                if d['fila_excel'] == 5:
                    for col, expected in HEADERS.get(sheet.attrib['name'], {}).items():
                        if key(d.get(col)) != key(expected):
                            raise ValueError(f"Columna inesperada en {sheet.attrib['name']}!{col}5: se esperaba {expected}")
                else:
                    rows.append(d)
            result[sheet.attrib['name']] = rows
        return result

def evaluate(sale, lists):
    """Solo devuelve un porcentaje si toda la evidencia permite comparar IVA incluido."""
    qty, subtotal, iva = number(sale.get('H')), number(sale.get('V')), number(sale.get('L'))
    obs, doc = key(sale.get('Y')), key(sale.get('E'))
    if 'nota de credito' in doc or doc.startswith('nc '): return None, 'Nota de crédito'
    if 'revertida' in obs: return None, 'Venta revertida'
    if sale.get('Z') or 'nc asociada' in obs or 'devolu' in obs: return None, 'Devolución pendiente de aclarar'
    if iva is None or iva <= 0: return None, 'Sin IVA cobrado'
    if subtotal == 0 or 'sin cargo' in obs: return None, 'Sin cargo'
    if not qty or qty <= 0 or subtotal is None or subtotal <= 0: return None, 'Importe o cantidad no válidos'
    if sale.get('P') != 'Lista vigente': return None, sale.get('P') or 'Sin respaldo de lista'
    candidates = [x for x in lists if x.get('A') == sale.get('G') and key(x.get('B')) == key(sale.get('C')) and unit(x.get('C')) == unit(sale.get('I'))]
    if not sale.get('G') or len(candidates) != 1: return None, 'Producto o presentación ambiguos'
    price = candidates[0]
    if key(sale.get('W')) != key(sale.get('C')) or unit(sale.get('X')) != unit(sale.get('I')): return None, 'Producto o unidad distintos'
    if number(price.get('F')) != iva: return None, 'Alícuota distinta'
    issued, generated, changed = date(sale.get('D')), date(sale.get('U')), date(price.get('G'))
    if not issued or not changed: return None, 'Vigencia sin respaldo'
    # La hora de generación solo sirve si corresponde al día de emisión.
    emitted = generated if generated and generated.date() == issued.date() else issued
    if changed > emitted or date(sale.get('T')) != changed or sale.get('S') != 'Ficha Dubix': return None, 'Vigencia sin respaldo'
    list_price = number(price.get('E'))
    if not list_price or list_price <= 0: return None, 'Lista sin precio'
    charged = subtotal / qty
    percent = Decimal(100) * (1 - charged / list_price)
    # Solo neutraliza el error máximo de redondear el subtotal a centavos.
    if abs(subtotal - qty * list_price) <= Decimal('.005'): percent = Decimal(0)
    return {'lista_con_iva': str(list_price), 'cobrado_con_iva': str(charged), 'porcentaje': str(percent), 'iva': str(iva), 'vigente_desde': changed.isoformat()}, None

def prepare(path):
    data = sheets(path)
    if 'Comprobantes' not in data or 'Listas de precios' not in data: raise ValueError('Faltan las hojas requeridas')
    records, reasons = [], collections.Counter()
    for row in data['Comprobantes']:
        if not row.get('E'): continue
        reference, reason = evaluate(row, data['Listas de precios'])
        if key(row.get('A')) == 'consumidor final' or 'cliente sin identificar' in key(row.get('Y')):
            reference, reason = None, 'Consumidor Final / cliente sin identificar'
        reasons[reason or 'Verificable'] += 1
        issued = date(row.get('D'))
        identity = '|'.join([row.get('E') or '', row.get('F') or ''])
        generated = date(row.get('U'))
        records.append({'clave': hashlib.sha256(identity.encode()).hexdigest(), 'cliente': row.get('A'), 'comercial': row.get('B'),
            'emitido_en': generated.isoformat() if generated and issued and generated.date()==issued.date() else None,
            'producto': row.get('C'), 'codigo': row.get('G'), 'unidad': unit(row.get('I')), 'fecha': issued.date().isoformat() if issued else None,
            'comprobante': row.get('E'), 'renglon': row.get('F'), 'cantidad': row.get('H'), 'subtotal_con_iva': row.get('V'),
            'referencia': reference, 'motivo': reason, 'fila_excel': row['fila_excel']})
    if len({r['clave'] for r in records}) != len(records): raise ValueError('Comprobante y renglón duplicados: revisar antes de importar')
    return {'fuente': Path(path).name, 'sha256': hashlib.sha256(Path(path).read_bytes()).hexdigest(), 'registros': records, 'resumen': dict(reasons)}

if __name__ == '__main__':
    p = argparse.ArgumentParser();p.add_argument('excel');p.add_argument('--salida', required=True)
    args = p.parse_args();result = prepare(args.excel)
    Path(args.salida).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'renglones': len(result['registros']), 'resumen': result['resumen']}, ensure_ascii=True))
