"""Repackage existing public-domain models. No training or further quantization."""
import argparse,base64,hashlib,json,struct,sys
from pathlib import Path


def prepare(library, website, slug, source_name, output_name, title, author):
    sys.path.insert(0,str(library/'src'))
    from neuralzip.archive import _context,_pack,decode
    folder=library/'hf/library/books'/slug
    config=json.loads((folder/'config.json').read_text())
    source=(library/'work'/source_name).read_bytes()
    sha=hashlib.sha256(source).hexdigest()
    assert sha==config['texts'][0]['sha256']
    raw=(folder/'model.safetensors').read_bytes();length=struct.unpack_from('<Q',raw)[0]
    table=json.loads(raw[8:8+length]);body=raw[8+length:]
    tensors=[];bf=bytearray();qdata=bytearray();scales=bytearray()
    for name,tensor in table.items():
        if name=='__metadata__' or name.endswith('.scale'):continue
        block=body[slice(*tensor['data_offsets'])];shape=tensor['shape']
        if name.endswith('.q'):
            scale=table[name[:-2]+'.scale'];scale_bytes=body[slice(*scale['data_offsets'])]
            tensors.append({'name':name[:-2],'kind':'q8','shape':shape,'numel':shape[0]*shape[1],
                'q_offset':len(qdata),'scale_offset':len(scales)//2})
            qdata.extend(block);scales.extend(scale_bytes)
        else:
            tensors.append({'name':name,'kind':'bf16','shape':shape,'numel':len(block)//2,'offset':len(bf)//2})
            bf.extend(block)
    b64=lambda b:base64.b64encode(b).decode('ascii')
    meta={'book_id':0,'chunk_len':config['chunk_len'],'n_chunks':config['n_chunks'],'total_len':len(source),'sha256':sha}
    pkg={'config':config['model'],'meta':meta,'tensors':tensors,'fixes':[],
        'weights_b64':b64(bf),'qdata_b64':b64(qdata),'scales_b64':b64(scales)}
    streams=[];per=max(1,(meta['n_chunks']+7)//8)
    with _context() as context:
        context.call('LCPEngine.beginEncode',pkg,b64(source),timeout_sec=15)
        for first in range(0,meta['n_chunks'],per):
            streams.append(context.call('LCPEngine.encodeOne',{'first':first,'count':min(per,meta['n_chunks']-first)},timeout_sec=60))
    payload=bytearray();blobs={};segments=[]
    def append(data):
        result={'offset':len(payload),'length':len(data)};payload.extend(data);return result
    for key,data in [('weights_b64',bf),('qdata_b64',qdata),('scales_b64',scales)]:blobs[key]=append(data)
    for stream in streams:segments.append({'first':stream['first'],'count':stream['count'],**append(base64.b64decode(stream['data']))})
    header={'format':'neurzip/1','codec':'neural','name':output_name+'.txt','size':len(source),'sha256':sha,
            'model':{'config':pkg['config'],'meta':meta,'tensors':tensors,'blobs':blobs,'bits':20,'segments':segments}}
    archive=_pack(header,bytes(payload));assert decode(archive,workers=1)==source
    dest=website/'public/samples';(dest/(output_name+'.nzip')).write_bytes(archive);(dest/(output_name+'.txt')).write_bytes(source)
    return {'id':output_name,'title':title,'author':author,'archive':'samples/'+output_name+'.nzip','text':'samples/'+output_name+'.txt',
            'sourceBytes':len(source),'archiveBytes':len(archive),'chunks':meta['n_chunks'],'sha256':sha,
            'license':'Public domain','provenance':'Existing trained model, unchanged q8 weights; new lossless stream verified against original bytes.'}


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--library',type=Path,required=True);args=parser.parse_args()
    website=Path(__file__).resolve().parent.parent
    entries=[]
    for spec in [('modest-proposal','modest-proposal.txt','modest-proposal','A Modest Proposal','Jonathan Swift'),
                 ('The-Yellow-Wallpaper','the-yellow-wallpaper.txt','yellow-wallpaper','The Yellow Wallpaper','Charlotte Perkins Gilman')]:
        result=prepare(args.library.resolve(),website,*spec);entries.append(result);print(json.dumps(result),flush=True)
    (website/'data/prepared-books.json').write_text(json.dumps(entries,indent=2)+'\n')


if __name__=='__main__':main()
