"""Valide les Factur-X générées : XSD, schématron EN 16931 (Factur-X 1.09), règles françaises BR-FR,
puis extraction du XML depuis le PDF et contrôle de la structure PDF/A-3.

Utilisation : pip install factur-x saxonche   puis   python3 outils/valider-facturx.py
"""
import glob, os, re, sys, io
import facturx
from lxml import etree
from saxonche import PySaxonProcessor
from pypdf import PdfReader

BASE = os.path.dirname(facturx.__file__) + '/xsd_and_schematron/'
XSLT = {
    'EN16931': BASE + 'facturx-en16931/FACTUR-X_EN16931.xslt',
    'BR-FR': BASE + 'cii-schematron-fr-ctc/BR-FR-Flux2-Schematron-CII.xslt',
}
FX = os.path.dirname(os.path.abspath(__file__)) + '/echantillons/'

proc = PySaxonProcessor(license=False)
xslt = proc.new_xslt30_processor()
compiled = {k: xslt.compile_stylesheet(stylesheet_file=v) for k, v in XSLT.items()}

total_err = 0
for xml_path in sorted(glob.glob(FX + '*.xml')):
    name = os.path.basename(xml_path)
    xml = open(xml_path, 'rb').read()
    print(f'=== {name}')
    # 1. XSD
    try:
        facturx.xml_check_xsd(xml, flavor='factur-x', level='en16931')
        print('  XSD EN16931 : OK')
    except Exception as e:
        total_err += 1
        print('  XSD EN16931 : ERREUR', str(e)[:600])
    # 2. Schématrons
    for k, exe in compiled.items():
        node = proc.parse_xml(xml_file_name=xml_path)
        svrl = exe.transform_to_string(xdm_node=node)
        root = etree.fromstring(svrl.encode())
        ns = {'svrl': 'http://purl.oclc.org/dsdl/svrl'}
        fails = root.findall('.//svrl:failed-assert', ns)
        errs = [f for f in fails if (f.get('flag') or 'fatal') in ('fatal', 'error')]
        warns = [f for f in fails if f not in errs]
        print(f'  Schématron {k} : {"OK" if not errs else "ERREURS"} ({len(errs)} erreur(s), {len(warns)} avertissement(s))')
        for f in fails:
            txt = re.sub(r'\s+', ' ', ''.join(f.find('svrl:text', ns).itertext())).strip()
            print(f'    [{f.get("flag") or "fatal"}] {f.get("id")} @ {f.get("location")[-90:]}\n      {txt[:300]}')
        total_err += len(errs)
    # 3. PDF : XML intégré + structure PDF/A
    pdf_path = xml_path[:-4] + '.pdf'
    pdf = open(pdf_path, 'rb').read()
    fname, embedded = facturx.get_xml_from_pdf(pdf, check_xsd=True)
    same = embedded == xml
    print(f'  PDF : pièce jointe {fname!r}, identique au XML : {same}')
    if not same:
        total_err += 1
    r = PdfReader(io.BytesIO(pdf))
    root = r.trailer['/Root']
    xmp = root['/Metadata'].get_object().get_data().decode()
    checks = {
        'en-tête %PDF-1.7': pdf[:8] == b'%PDF-1.7',
        'commentaire binaire': all(b > 127 for b in pdf[10:14]),
        '/ID dans le trailer': '/ID' in r.trailer,
        'OutputIntent GTS_PDFA1': root['/OutputIntents'][0].get_object()['/S'] == '/GTS_PDFA1',
        'XMP pdfaid:part=3': '<pdfaid:part>3</pdfaid:part>' in xmp,
        'XMP fx:ConformanceLevel': 'EN 16931' in xmp,
        '/AF + AFRelationship': '/AF' in root and root['/AF'][0].get_object()['/AFRelationship'] in ('/Data', '/Alternative'),
        'Sous-type text/xml': True,
        'polices intégrées': True,
    }
    ef = root['/AF'][0].get_object()['/EF']['/F'].get_object()
    checks['Sous-type text/xml'] = ef['/Subtype'] == '/text#2Fxml' or str(ef['/Subtype']) == '/text/xml'
    for p in r.pages:
        fonts = p['/Resources'].get('/Font', {})
        for fk, fref in fonts.items():
            f = fref.get_object()
            desc = f['/DescendantFonts'][0].get_object()['/FontDescriptor'] if '/DescendantFonts' in f else f.get('/FontDescriptor')
            if desc is None or not any(k in desc for k in ('/FontFile', '/FontFile2', '/FontFile3')):
                checks['polices intégrées'] = False
    meta = r.metadata
    checks['Info/XMP Titre cohérent'] = (meta.title or '') in xmp
    for k, v in checks.items():
        if not v:
            total_err += 1
        print(f'    {"✔" if v else "✘"} {k}')

for pdf_path in sorted(glob.glob(FX + '0[67]*.pdf')):
    r = PdfReader(pdf_path)
    print(f'=== {os.path.basename(pdf_path)} : {len(r.pages)} page(s), pièce jointe : {"/AF" in r.trailer["/Root"]}')

print('\nTOTAL ERREURS :', total_err)
sys.exit(1 if total_err else 0)
