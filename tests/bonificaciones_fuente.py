import sys
from pathlib import Path
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from bonificaciones_importar import evaluate

class Fuente(unittest.TestCase):
    def setUp(self):
        self.sale={'C':'Carne caja 20kg','G':'C1','H':'2','I':'kg','L':'10,5%','V':'22100','D':'46350','U':'46350.5','T':'46340','P':'Lista vigente','S':'Ficha Dubix','E':'Factura A 0001','W':'Carne caja 20kg','X':'kg','K':'0'}
        self.prices=[{'A':'C1','B':'Carne caja 20kg','C':'Kilogramos','E':'11050','F':'10,5%','G':'46340'}]
    def test_carne_a_lista_es_cero(self):
        self.assertEqual(evaluate(self.sale,self.prices)[0]['porcentaje'],'0')
    def test_carne_cinco_iva_no_es_bonificacion(self):
        self.sale['V']='20995'
        self.assertEqual(float(evaluate(self.sale,self.prices)[0]['porcentaje']),5)
    def test_implicita_sin_sumar_bonificacion_registrada(self):
        self.sale.update(V='19890',K='.05')
        self.assertEqual(float(evaluate(self.sale,self.prices)[0]['porcentaje']),10)
    def test_sin_iva(self):
        for iva in ['No Gravado','0%']:
            self.sale['L']=iva;self.assertIsNone(evaluate(self.sale,self.prices)[0])
    def test_sin_cargo(self):
        self.sale['V']='0';self.assertIsNone(evaluate(self.sale,self.prices)[0])
    def test_codigo_reutilizado_y_unidad(self):
        self.prices[0]['B']='Otro corte';self.assertIsNone(evaluate(self.sale,self.prices)[0])
        self.prices[0]['B']=self.sale['C'];self.sale['I']='u';self.assertIsNone(evaluate(self.sale,self.prices)[0])
    def test_vigencia_futura_y_estimacion(self):
        self.prices[0]['G']='46351';self.assertIsNone(evaluate(self.sale,self.prices)[0])
        self.prices[0]['G']='46340';self.sale['P']='Lista histórica estimada';self.assertIsNone(evaluate(self.sale,self.prices)[0])
    def test_reversion_nc_y_devolucion(self):
        for obs in ['Factura revertida','Factura con NC asociada','Devolución pendiente']:
            self.sale['Y']=obs;self.assertIsNone(evaluate(self.sale,self.prices)[0])
    def test_sobre_lista(self):
        self.sale['V']='23205';self.assertEqual(float(evaluate(self.sale,self.prices)[0]['porcentaje']),-5)

if __name__=='__main__':unittest.main()
