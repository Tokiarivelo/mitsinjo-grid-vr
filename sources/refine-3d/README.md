# sources/refine-3d — lot entrainement generation 3D

18 photos (960 px, objet isole) : 6 vehicules, 4 arbres, 4 meubles, 4 machines domestiques.

Capturer chacune (coute des appels API Meta) :

```bash
make shape-capture PHOTO=sources/refine-3d/bus.jpg ID=bus LABEL="city bus"
make shape-capture PHOTO=sources/refine-3d/lorry.jpg ID=lorry LABEL="truck"
make shape-capture PHOTO=sources/refine-3d/tractor.jpg ID=tractor LABEL="farm tractor"
make shape-capture PHOTO=sources/refine-3d/beetle.jpg ID=beetle LABEL="vintage beetle car"
make shape-capture PHOTO=sources/refine-3d/motorhome.jpg ID=motorhome LABEL="camper motorhome"
make shape-capture PHOTO=sources/refine-3d/limo.jpg ID=limo LABEL="stretch limousine"
make shape-capture PHOTO=sources/refine-3d/oak.jpg ID=oak LABEL="oak tree"
make shape-capture PHOTO=sources/refine-3d/eucalyptus.jpg ID=eucalyptus LABEL="eucalyptus tree"
make shape-capture PHOTO=sources/refine-3d/mango.jpg ID=mango LABEL="mango tree"
make shape-capture PHOTO=sources/refine-3d/banana.jpg ID=banana LABEL="banana tree"
make shape-capture PHOTO=sources/refine-3d/sofa.jpg ID=sofa LABEL="sofa"
make shape-capture PHOTO=sources/refine-3d/chair.jpg ID=chair LABEL="chair"
make shape-capture PHOTO=sources/refine-3d/table.jpg ID=table LABEL="dining table"
make shape-capture PHOTO=sources/refine-3d/bed.jpg ID=bed LABEL="double bed"
make shape-capture PHOTO=sources/refine-3d/sewing.jpg ID=sewing LABEL="sewing machine"
make shape-capture PHOTO=sources/refine-3d/microwave.jpg ID=microwave LABEL="microwave oven"
make shape-capture PHOTO=sources/refine-3d/aircon.jpg ID=aircon LABEL="air conditioner"
make shape-capture PHOTO=sources/refine-3d/vacuum.jpg ID=vacuum LABEL="vacuum cleaner"
```
