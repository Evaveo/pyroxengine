"""Studio V2 operations. Scoped scene edits, no eval/exec or generated Python."""
import json
import math
import time
import uuid
from pathlib import Path
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix
from . import pipeline as p
from .common import scoped, slug, atomic_json


def vec(value,n=3):
    if not isinstance(value,(list,tuple)) or len(value)!=n:raise ValueError(f'{n} nombres attendus.')
    a=[float(x) for x in value]
    if not all(math.isfinite(x) and abs(x)<10000 for x in a):raise ValueError('Valeur non finie ou hors limites.')
    return a


def number(x,lo,hi):
    x=float(x)
    if not math.isfinite(x) or not lo<=x<=hi:raise ValueError(f'Valeur attendue entre {lo} et {hi}.')
    return x


def spec(args):
    a=args.get('spec_json','{}');s=json.loads(a) if isinstance(a,str) else a
    if not isinstance(s,dict):raise ValueError('Objet JSON attendu.')
    return args['action'],s


def owned(scene,name,kind=None):
    # Un objet créé sous le nom « Crown » s'appelle « EV_Crown » dans Blender : les deux sont acceptés,
    # sinon chaque appelant devait deviner le préfixe (les 18 échecs de l'essai complet du 2026-10-01).
    obj=scene.objects.get(name)
    if (not obj or obj.get('ev_run')!=scene.get('ev_run')) and not str(name).startswith('EV_'):obj=scene.objects.get('EV_'+str(name))
    if not obj or obj.get('ev_run')!=scene.get('ev_run'):raise ValueError('Objet hors projet ou absent : '+str(name))
    if kind and obj.type!=kind:raise ValueError('Type attendu : '+kind)
    return obj


def sources(scene,names=None):
    items=[owned(scene,n,'MESH') for n in names] if names else p.objects(scene,'source')
    if any(o.get('ev_role')!='source' for o in items):raise ValueError('Modifier les sources, puis reconstruire les dérivés.')
    return items


def mark(obj,scene,role='source'):
    obj['ev_run']=scene['ev_run'];obj['ev_role']=role;obj['ev_uid']=uuid.uuid4().hex


def invalidate(root,scene,m):
    m['source_objects']=[o.name for o in p.objects(scene,'source')]
    m['atlas']=None;m['exports']=[]
    m.pop('preview_atlas',None);m.pop('preview_source',None)
    p.put_manifest(root,m)
    p.show_stage(scene,'source')


def mat_for(root,scene,identifier=None):
    identifier=identifier or p.manifest(root)['material_id']
    for obj in p.objects(scene,'source'):
        for mat in obj.data.materials:
            if mat and mat.get('ev_material_id')==identifier:return mat
    entry=p.catalog(root).get(identifier)
    if not entry:raise ValueError('Matériau inconnu : '+identifier)
    return material_from_record(root,entry)


def finish_mesh(root,scene,m,name,verts,faces,identifier=None,smooth=False):
    name=slug(name)
    if not 3<=len(verts)<=20000 or not 1<=len(faces)<=40000:raise ValueError('Mesh limité à 20 000 sommets et 40 000 faces par appel.')
    verts=[vec(v) for v in verts]
    for f in faces:
        if len(f)<3 or len(f)>256 or len(set(f))!=len(f) or any(not isinstance(i,int) or i<0 or i>=len(verts) for i in f):raise ValueError('Face invalide.')
    mat=mat_for(root,scene,identifier)
    mesh=bpy.data.meshes.new('EV_'+name);mesh.from_pydata(verts,[],faces);mesh.validate();mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    obj=bpy.data.objects.new('EV_'+name,mesh);bpy.data.collections[m['source_collection']].objects.link(obj)
    mark(obj,scene);obj.data.materials.append(mat)
    for f in mesh.polygons:f.use_smooth=bool(smooth)
    p.tile_uv(obj);p.select_only([obj]);invalidate(root,scene,m)
    return obj


def mesh_info(obj):
    out={'object':obj.name,'type':obj.type,'location':list(obj.location),'rotation_deg':[math.degrees(x) for x in obj.rotation_euler],
         'scale':list(obj.scale),'dimensions':list(obj.dimensions),'role':obj.get('ev_role'),
         'modifiers':[{'name':x.name,'type':x.type} for x in obj.modifiers]}
    if obj.type=='MESH':
        obj.data.calc_loop_triangles()
        out.update(vertices=len(obj.data.vertices),faces=len(obj.data.polygons),triangles=len(obj.data.loop_triangles),
                   uv_maps=[x.name for x in obj.data.uv_layers],materials=[x.name if x else None for x in obj.data.materials],
                   vertex_groups=[x.name for x in obj.vertex_groups],shape_keys=[x.name for x in obj.data.shape_keys.key_blocks] if obj.data.shape_keys else [])
    return out


def save_snapshot(root,scene,m,label):
    identifier=uuid.uuid4().hex[:12]
    for obj in scene.objects:
        if obj.get('ev_run')==scene['ev_run'] and not obj.get('ev_uid'):obj['ev_uid']=uuid.uuid4().hex
    file=p.checkpoint(root,scene,m['run_dir'],'checkpoints/'+identifier+'_'+slug(label))
    data={'id':identifier,'label':label,'created_at':time.time(),'blend':str(Path(file).relative_to(root)),
          'manifest':m,'objects':{o.name:o.get('ev_uid') for o in scene.objects if o.get('ev_uid')}}
    atomic_json(scoped(root,'checkpoints/'+identifier+'.json'),data)
    return {'checkpoint_id':identifier,'blend':file,'label':label}


def project_action(root,args,job):
    action,s=spec(args)
    if action=='new':
        name=slug(s.get('name','Projet'));run=uuid.uuid4().hex[:10]
        scene=bpy.data.scenes.new('EV_'+name+'_'+run);scene['ev_run']=run;p.activate(scene)
        scene.evaveo_project=str(root)
        src=p.collection(scene,'EV_Source_'+run);src['ev_source']=True
        stage=p.collection(scene,'EV_Studio_'+run);p.add_stage(scene,stage)
        m={'version':'0.2.0','run_id':run,'run_dir':'runs/'+run,'scene':scene.name,'source_collection':src.name,
           'source_objects':[],'material_id':'neutral_v2','atlas':None,'settings':{'fps':30,'triangle_budget':50000,'texture_size':1024},'created_at':time.time()}
        scene.render.fps=30;p.put_manifest(root,m)
        cat=p.catalog(root)
        if 'neutral_v2' not in cat:
            cat['neutral_v2']={'id':'neutral_v2','maps':{},'basecolor':[.35,.5,.6,1],'roughness':.55,'metallic':0,'tile_size_m':1}
            atomic_json(scoped(root,'materials/catalog.json'),cat)
        return {'scene':scene.name,'material_id':'neutral_v2','empty':True}
    if action=='list':
        snapshots=[json.loads(f.read_text(encoding='utf-8')) for f in scoped(root,'checkpoints').glob('*.json')]
        return {'checkpoints':[{k:d[k] for k in ('id','label','created_at')} for d in snapshots],
                'project':p.manifest(root) if scoped(root,'project.json').exists() else None}
    if action=='restore':
        identifier=slug(s['checkpoint_id']);d=json.loads(scoped(root,'checkpoints/'+identifier+'.json').read_text(encoding='utf-8'))
        with bpy.data.libraries.load(str(scoped(root,d['blend'])),link=False) as (old,new):new.scenes=old.scenes
        scene=new.scenes[0];p.activate(scene);m=d['manifest'];m['scene']=scene.name
        mapping={name:next((o.name for o in scene.objects if o.get('ev_uid')==uid),name) for name,uid in d['objects'].items()}
        m['source_objects']=[mapping.get(n,n) for n in m['source_objects']]
        src=next((c for c in scene.collection.children if any(o.get('ev_role')=='source' for o in c.objects)),None)
        if src:m['source_collection']=src.name
        if m.get('atlas'):
            m['atlas']['objects']=[mapping.get(n,n) for n in m['atlas']['objects']]
            first=scene.objects.get(m['atlas']['objects'][0]);m['atlas']['material']=first.data.materials[0].name
        p.put_manifest(root,m)
        return {'scene':scene.name,'restored_checkpoint':identifier,'previous_scenes_preserved':True}
    scene,m=p.scene_for(root)
    if action=='save':return save_snapshot(root,scene,m,s.get('label','checkpoint'))
    if action=='settings':
        settings=m.setdefault('settings',{})
        if 'fps' in s:scene.render.fps=int(number(s['fps'],1,120));settings['fps']=scene.render.fps
        for key,lo,hi in [('triangle_budget',100,2000000),('texture_size',256,8192),('render_samples',1,256)]:
            if key in s:settings[key]=int(number(s[key],lo,hi))
        if 'render_device' in s:
            device=s['render_device']
            if device not in ('CPU','GPU'):raise ValueError('CPU ou GPU attendu.')
            if device=='GPU':
                pref=bpy.context.preferences.addons['cycles'].preferences
                found=False
                for backend in ('OPTIX','CUDA','HIP','METAL','ONEAPI'):
                    try:
                        pref.compute_device_type=backend;pref.get_devices()
                        gpu=[d for d in pref.devices if d.type!='CPU']
                        if gpu:
                            for d in pref.devices:d.use=d.type!='CPU'
                            found=True;break
                    except Exception:continue
                if not found:raise ValueError('Aucun périphérique Cycles GPU utilisable détecté.')
            settings['render_device']=device;scene.cycles.device=device
        p.put_manifest(root,m);return {'settings':settings}
    raise ValueError('Action inconnue.')


def target_name(name):
    # Le nom Blender d'un objet du projet : « EV_ » + identifiant, comme à la création.
    name=str(name)
    return 'EV_'+slug(name[3:]) if name.startswith('EV_') else 'EV_'+slug(name)


def rename_object(root,scene,m,s):
    # Après `blender_project restore`, la scène restaurée cohabite avec l'ancienne : ses objets
    # prennent des suffixes « .002 » (les noms Blender sont uniques dans tout le fichier).
    obj=owned(scene,s['object']);old=obj.name;new=target_name(s['name'])
    if new==old:return {'renamed':old,'object':old,'note':'déjà ce nom'}
    clash=bpy.data.objects.get(new);freed=None
    if clash is not None:
        if scene.objects.get(clash.name) is clash:raise ValueError('Nom déjà pris dans cette scène : '+new)
        # Le nom est tenu par un objet d'une AUTRE scène (version restaurée remplacée) : on le libère.
        clash.name=new+'_prev';freed=clash.name
    obj.name=new
    if obj.type=='MESH' and obj.get('ev_role')=='source':invalidate(root,scene,m)
    out={'renamed':old,'object':obj.name}
    if freed:out['note']='le nom était tenu par un objet d’une autre scène, renommé '+freed
    return out


def pick_named(items,names,what='objects'):
    # Choisit des objets par nom exact, avec ou sans le préfixe « EV_ ».
    if not isinstance(names,list) or not names or not all(isinstance(n,str) for n in names):
        raise ValueError(what+' : liste de noms attendue.')
    out=[]
    for n in names:
        o=next((x for x in items if x.name==n or x.name=='EV_'+n),None)
        if o is None:raise ValueError(what+' : « '+n+' » absent. Disponibles : '+', '.join(x.name for x in items))
        if o not in out:out.append(o)
    return out


def world_box(items):
    pts=[o.matrix_world@Vector(c) for o in items for c in o.bound_box]
    lo=Vector([min(v[i] for v in pts) for i in range(3)]);hi=Vector([max(v[i] for v in pts) for i in range(3)])
    return lo,hi


def export_pivot(spec_origin,items):
    # Le point qui deviendra l'origine du GLB, en coordonnées monde Blender (Z vertical), ou None.
    if spec_origin in (None,'keep'):return None
    if isinstance(spec_origin,(list,tuple)):return Vector(vec(spec_origin))
    lo,hi=world_box(items)
    if spec_origin=='bottom':return Vector(((lo.x+hi.x)/2,(lo.y+hi.y)/2,lo.z))
    if spec_origin=='center':return (lo+hi)/2
    raise ValueError('origin : keep, bottom, center ou [x, y, z].')


def model_geometry(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    if action in ('mesh','sweep','lathe','extrude'):
        verts=[];faces=[]
        if action=='mesh':verts,faces=s['vertices'],s['faces']
        elif action=='sweep':
            path=[Vector(vec(v)) for v in s['path']];radii=[vec(v,2) for v in s['radii']]
            seg=int(number(s.get('segments',16),3,128))
            if not 2<=len(path)<=128 or len(radii)!=len(path):raise ValueError('2 à 128 sections, un rayon XY par section.')
            last_u=None
            for i,(center,rad) in enumerate(zip(path,radii)):
                if min(rad)<=0:raise ValueError('Rayons positifs requis.')
                tangent=path[min(i+1,len(path)-1)]-path[max(0,i-1)]
                if tangent.length<1e-6:raise ValueError('Sections confondues.')
                tangent.normalize()
                u=(last_u-tangent*last_u.dot(tangent)) if last_u is not None else Vector((1,0,0))-tangent*tangent.x
                if u.length<.001:u=Vector((0,1,0))-tangent*tangent.y
                u.normalize();v=tangent.cross(u).normalized();last_u=u
                for k in range(seg):
                    t=2*math.pi*k/seg;verts.append(list(center+u*rad[0]*math.cos(t)+v*rad[1]*math.sin(t)))
                if i:
                    for k in range(seg):faces.append([(i-1)*seg+k,(i-1)*seg+(k+1)%seg,i*seg+(k+1)%seg,i*seg+k])
            if s.get('caps',True):faces.extend([list(reversed(range(seg))),list(range((len(path)-1)*seg,len(path)*seg))])
        elif action=='lathe':
            profile=[vec(v,2) for v in s['profile']];seg=int(number(s.get('segments',32),3,128))
            if not 2<=len(profile)<=128:raise ValueError('Profil : 2 à 128 points.')
            for i,(radius,z) in enumerate(profile):
                radius=number(radius,.0001,100)
                for k in range(seg):verts.append([radius*math.cos(k*2*math.pi/seg),radius*math.sin(k*2*math.pi/seg),z])
                if i:
                    for k in range(seg):faces.append([(i-1)*seg+k,(i-1)*seg+(k+1)%seg,i*seg+(k+1)%seg,i*seg+k])
            faces.extend([list(reversed(range(seg))),list(range((len(profile)-1)*seg,len(profile)*seg))])
        else:
            poly=[vec(v,2) for v in s['polygon']];depth=number(s['depth'],.001,100);n=len(poly)
            if not 3<=n<=128:raise ValueError('Polygone : 3 à 128 points.')
            verts=[[x,y,z] for z in (0,depth) for x,y in poly]
            faces=[list(reversed(range(n))),list(range(n,2*n))]+[[i,(i+1)%n,(i+1)%n+n,i+n] for i in range(n)]
        obj=finish_mesh(root,scene,m,s['name'],verts,faces,s.get('material_id'),s.get('smooth',False))
        return mesh_info(obj)
    if action=='rename':return rename_object(root,scene,m,s)
    items=sources(scene,s.get('objects')) if action in ('join','delete','cleanup') else sources(scene,[s['object']])
    obj=items[0] if items else None
    if not obj:raise ValueError('Aucun objet source.')
    if action in ('join','delete','cleanup','edit_vertices') or (action=='modifier' and s.get('apply')):
        save_snapshot(root,scene,m,'avant_'+action)
    if action=='modifier':
        typ=s['type'];settings=s.get('settings',{})
        if typ not in ('BEVEL','MIRROR','SUBSURF','SOLIDIFY','DECIMATE','REMESH','BOOLEAN'):raise ValueError('Modificateur non pris en charge.')
        if s.get('apply') and (obj.data.shape_keys or obj.find_armature()):raise ValueError('Finaliser la topologie avant le rig/shape keys; modificateur non appliqué.')
        mod=obj.modifiers.new('EV_'+typ,typ)
        try:
            if typ=='BEVEL':mod.width=number(settings.get('width',.01),0,1);mod.segments=int(number(settings.get('segments',2),1,8))
            if typ=='SUBSURF':mod.levels=int(number(settings.get('levels',1),0,3));mod.render_levels=mod.levels
            if typ=='SOLIDIFY':mod.thickness=number(settings.get('thickness',.01),-.5,.5)
            if typ=='DECIMATE':mod.ratio=number(settings.get('ratio',.5),.01,1)
            if typ=='MIRROR':mod.use_axis=[bool(x) for x in settings.get('axes',[True,False,False])];mod.use_clip=True
            if typ=='REMESH':mod.mode='VOXEL';mod.voxel_size=number(settings.get('voxel_size',.04),.005,1)
            if typ=='BOOLEAN':
                mod.object=sources(scene,[settings['operand']])[0]
                if mod.object==obj:raise ValueError('Operand distinct requis.')
                mod.operation=settings.get('operation','DIFFERENCE');mod.solver='EXACT'
            if s.get('apply'):
                p.select_only([obj]);bpy.ops.object.modifier_apply(modifier=mod.name)
                if typ=='REMESH':p.tile_uv(obj)
        except Exception:
            if mod and mod.name in obj.modifiers:obj.modifiers.remove(mod)
            raise
    elif action=='transform':
        if 'location' in s:obj.location=vec(s['location'])
        if 'rotation_deg' in s:obj.rotation_euler=[math.radians(x) for x in vec(s['rotation_deg'])]
        if 'scale' in s:
            scale=vec(s['scale'])
            if min(abs(v) for v in scale)<.0001:raise ValueError('Échelle nulle interdite.')
            obj.scale=scale
        if s.get('apply'):p.select_only([obj]);bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    elif action=='duplicate':
        copy=obj.copy();copy.data=obj.data.copy();copy.name='EV_'+slug(s['name']);bpy.data.collections[m['source_collection']].objects.link(copy)
        mark(copy,scene);copy.location+=Vector(vec(s.get('offset',[0,0,0])));obj=copy
    elif action=='join':
        if any(o.find_armature() or o.data.shape_keys for o in items):raise ValueError('Joindre avant le rig et les shape keys.')
        p.select_only(items);bpy.ops.object.join();obj=bpy.context.object;obj.name='EV_'+slug(s['name'])
    elif action=='delete':
        names=[o.name for o in items]
        for o in items:bpy.data.objects.remove(o,do_unlink=True)
        invalidate(root,scene,m);return {'deleted':names}
    elif action=='edit_vertices':
        changes=[(int(c['index']),vec(c['position'])) for c in s['changes']]
        if any(i<0 or i>=len(obj.data.vertices) for i,_ in changes):raise ValueError('Indice sommet invalide.')
        for i,coord in changes:obj.data.vertices[i].co=coord
        obj.data.update()
    elif action=='cleanup':
        # L'OMBRAGE N'EST TOUCHÉ QUE SI `smooth` EST DONNÉ. Avant, le nettoyage lissait tout par défaut,
        # en silence : un meuble à arêtes vives ressortait « mou » sans que rien ne le dise.
        shading=None
        if 'smooth' in s:shading='smooth' if bool(s['smooth']) else 'flat'
        report=[]
        for o in items:
            if o.data.shape_keys or o.find_armature():raise ValueError('Nettoyer avant le rig et les shape keys.')
            bm=bmesh.new();bm.from_mesh(o.data);before=len(bm.verts)
            bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=number(s.get('merge_distance',.00001),0,.01))
            merged=before-len(bm.verts)
            bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(o.data);bm.free();o.data.update()
            if shading:
                for face in o.data.polygons:face.use_smooth=(shading=='smooth')
            report.append({'object':o.name,'merged_vertices':merged,'normals':'recalculées',
                           'shading':shading or 'inchangé (passer smooth:true|false pour le changer)'})
        invalidate(root,scene,m);return {'cleanup':report}
    elif action=='origin':
        p.select_only([obj]);mode=s.get('mode','BOTTOM');cursor=scene.cursor.location.copy()
        try:
            if mode=='BOTTOM':
                pts=[obj.matrix_world@Vector(c) for c in obj.bound_box]
                scene.cursor.location=((min(v.x for v in pts)+max(v.x for v in pts))/2,(min(v.y for v in pts)+max(v.y for v in pts))/2,min(v.z for v in pts))
            bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY' if mode=='GEOMETRY' else 'ORIGIN_CURSOR')
        finally:scene.cursor.location=cursor
    else:raise ValueError('Action inconnue.')
    invalidate(root,scene,m);return mesh_info(obj)


def material_from_record(root,entry):
    mat=BASE_MATERIAL_FACTORY(root,entry);tree=mat.node_tree;bsdf=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value=entry.get('basecolor',[.4,.4,.4,1])
    bsdf.inputs['Emission Color'].default_value=(*entry.get('emission',[0,0,0]),1)
    bsdf.inputs['Emission Strength'].default_value=entry.get('emission_strength',0)
    for node in tree.nodes:
        if node.type=='NORMAL_MAP':node.inputs['Strength'].default_value=entry.get('normal_strength',1)
    uv=next(n for n in tree.nodes if n.type=='UVMAP')
    for channel in ('height','emission'):
        if channel not in entry.get('maps',{}):continue
        tex=tree.nodes.new('ShaderNodeTexImage');tex.image=bpy.data.images.load(str(scoped(root,entry['maps'][channel])),check_existing=True)
        tex.image.colorspace_settings.name='sRGB' if channel=='emission' else 'Non-Color'
        tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
        if channel=='emission':tree.links.new(tex.outputs['Color'],bsdf.inputs['Emission Color'])
        else:
            bump=tree.nodes.new('ShaderNodeBump');bump.inputs['Distance'].default_value=.02
            if bsdf.inputs['Normal'].is_linked:tree.links.new(bsdf.inputs['Normal'].links[0].from_socket,bump.inputs['Normal'])
            tree.links.new(tex.outputs['Color'],bump.inputs['Height']);tree.links.new(bump.outputs[0],bsdf.inputs['Normal'])
    if entry.get('procedural'):
        settings=entry['procedural'];typ=settings['pattern']
        if typ in ('wood','fabric'):node=tree.nodes.new('ShaderNodeTexWave');node.wave_type='BANDS';node.bands_direction='X';node.inputs['Distortion'].default_value=2 if typ=='wood' else .1
        elif typ=='checker':node=tree.nodes.new('ShaderNodeTexChecker')
        else:node=tree.nodes.new('ShaderNodeTexNoise');node.inputs['Detail'].default_value=4
        node.inputs['Scale'].default_value=settings.get('scale',5);tree.links.new(uv.outputs[0],node.inputs['Vector'])
        ramp=tree.nodes.new('ShaderNodeValToRGB')
        colors=settings.get('colors',[[.12,.06,.02],[.5,.25,.06]])
        for i in range(2):ramp.color_ramp.elements[i].color=(*colors[i],1)
        tree.links.new(node.outputs['Fac'],ramp.inputs[0]);tree.links.new(ramp.outputs[0],bsdf.inputs['Base Color'])
        bump=tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.15;bump.inputs['Distance'].default_value=.015
        tree.links.new(node.outputs['Fac'],bump.inputs['Height']);tree.links.new(bump.outputs[0],bsdf.inputs['Normal'])
    return mat


def material_action(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root);cat=p.catalog(root)
    if action=='list':return {'materials':cat}
    if action=='inspect':return cat[s['id']]
    if action in ('create','procedural'):
        identifier=slug(s['id'])
        if identifier in cat:raise ValueError('Matériau déjà présent; choisir un nouvel identifiant de variante.')
        entry={'id':identifier,'maps':{},'basecolor':vec(s.get('basecolor',[.4,.4,.4,1]),4),
               'roughness':number(s.get('roughness',.5),0,1),'metallic':number(s.get('metallic',0),0,1),
               'tile_size_m':number(s.get('tile_size_m',1),.01,100),'normal_strength':number(s.get('normal_strength',1),0,5),
               'emission':vec(s.get('emission',[0,0,0])),'emission_strength':number(s.get('emission_strength',0),0,100)}
        for key,value in s.get('maps',{}).items():
            if key not in ('basecolor','roughness','metallic','normal','ao','emission','height'):raise ValueError('Carte inconnue.')
            file=scoped(root,value)
            if file.suffix.lower() not in ('.png','.jpg','.jpeg','.webp') or not file.is_file():raise ValueError('Image de carte absente.')
            entry['maps'][key]=str(file.relative_to(root))
        if action=='procedural':
            typ=s.get('pattern','wood')
            if typ not in ('wood','stone','fabric','metal','checker'):raise ValueError('Motif inconnu.')
            entry['procedural']={'pattern':typ,'colors':[vec(c) for c in s.get('colors',[[.1,.1,.1],[.5,.5,.5]])],
                                 'scale':number(s.get('scale',5),.01,200)}
        mat=material_from_record(root,entry);cat[identifier]=entry;atomic_json(scoped(root,'materials/catalog.json'),cat)
        return {'id':identifier,'material':mat.name,'maps':entry['maps']}
    if action=='assign':
        items=sources(scene,s.get('objects'));mat=mat_for(root,scene,s['id']);indices=s.get('faces')
        if indices is not None and len(items)!=1:raise ValueError('Affectation par faces : un objet à la fois.')
        for obj in items:
            if indices is None:obj.data.materials.clear();obj.data.materials.append(mat);indices_here=range(len(obj.data.polygons));index=0
            else:
                if any(not isinstance(i,int) or i<0 or i>=len(obj.data.polygons) for i in indices):raise ValueError('Face invalide.')
                if mat.name not in obj.data.materials:obj.data.materials.append(mat)
                index=obj.data.materials.find(mat.name);indices_here=indices
            for i in indices_here:obj.data.polygons[i].material_index=index
        invalidate(root,scene,m);return {'objects':[o.name for o in items],'material_id':s['id']}
    if action=='pack':
        size=int(number(s.get('size',1024),256,4096));out=scoped(root,s.get('output',m['run_dir']+'/packed_'+job['job_id'][:8]));out.mkdir(parents=True,exist_ok=True)
        def load_channel(key,default):
            if not s.get(key):return np.full((size,size),default,dtype=np.float32)
            im=bpy.data.images.load(str(scoped(root,s[key])),check_existing=False);im.colorspace_settings.name='Non-Color';im.scale(size,size)
            a=np.empty(size*size*4,np.float32);im.pixels.foreach_get(a);bpy.data.images.remove(im);return a.reshape(size,size,4)[:,:,0]
        rough=load_channel('roughness',.5);metal=load_channel('metallic',0);ao=load_channel('ao',1)
        rgba=np.ones((size,size,4),np.float32);rgba[:,:,0]=ao;rgba[:,:,1]=rough;rgba[:,:,2]=metal
        p.array_image('EV_ORM',rgba,out/'ORM.png')
        rgba[:,:,:3]=0;rgba[:,:,0]=metal;rgba[:,:,3]=1-rough;p.array_image('EV_Unity',rgba,out/'MetallicSmoothness.png')
        return {'files':[str(out/'ORM.png'),str(out/'MetallicSmoothness.png')]}
    raise ValueError('Action inconnue.')


def uv_action(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    items=sources(scene,[s['object']]) if 'object' in s else sources(scene,s.get('objects'))
    name=s.get('uv_name','EV_Tile')
    if action=='lightmap':name='EV_Lightmap'
    for obj in items:
        p.select_only([obj])
        if action=='seams':
            indices=s.get('edges',[])
            if any(not isinstance(i,int) or i<0 or i>=len(obj.data.edges) for i in indices):raise ValueError('Arête invalide.')
            if s.get('clear'):
                for edge in obj.data.edges:edge.use_seam=False
            for i in indices:obj.data.edges[i].use_seam=True
        elif action in ('unwrap','lightmap'):
            method=s.get('method','SMART');old=obj.data.uv_layers.active.name if obj.data.uv_layers.active else None
            if method=='TILE' and action!='lightmap':p.tile_uv(obj,s.get('tile_size_m',1));continue
            uv=obj.data.uv_layers.get(name) or obj.data.uv_layers.new(name=name);obj.data.uv_layers.active=uv
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
            try:
                margin=number(s.get('margin',.02),.001,.15)
                if method=='ANGLE':bpy.ops.uv.unwrap(method='ANGLE_BASED',margin=margin)
                else:bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=margin)
            finally:bpy.ops.object.mode_set(mode='OBJECT')
            if action=='lightmap' and old:obj.data.uv_layers.active=obj.data.uv_layers[old]
            else:obj.data.uv_layers[name].active_render=True
        elif action=='transform':
            uv=obj.data.uv_layers[name];scale=vec(s.get('scale',[1,1]),2);offset=vec(s.get('offset',[0,0]),2);angle=math.radians(number(s.get('rotation_deg',0),-36000,36000))
            for loop in uv.data:
                u,v=loop.uv;loop.uv=(scale[0]*(u*math.cos(angle)-v*math.sin(angle))+offset[0],scale[1]*(u*math.sin(angle)+v*math.cos(angle))+offset[1])
        elif action=='layout':
            size=int(number(s.get('size',1024),256,4096));uv=obj.data.uv_layers[name];a=np.ones((size,size,4),np.float32);a[:,:,:3]=.045
            for face in obj.data.polygons:
                ids=list(face.loop_indices)
                for i,j in zip(ids,ids[1:]+ids[:1]):
                    aa=np.array(uv.data[i].uv[:])*(size-1);bb=np.array(uv.data[j].uv[:])*(size-1)
                    samples=min(size*4,max(2,int(np.linalg.norm(bb-aa))+1));points=np.linspace(aa,bb,samples).round().astype(int)
                    inside=(points[:,0]>=0)&(points[:,0]<size)&(points[:,1]>=0)&(points[:,1]<size);points=points[inside]
                    a[points[:,1],points[:,0],:3]=(.1,.8,.75)
            file=scoped(root,s.get('output',m['run_dir']+'/uv/'+obj.name+'.png'));p.array_image('EV_UV_Layout',a,file,True)
            return {'image':str(file),'uv_name':name}
        else:raise ValueError('Action inconnue.')
    if action!='layout':invalidate(root,scene,m)
    return {'objects':[o.name for o in items],'uv_name':name}


def audit(root,scene,stage,budget):
    rows=[];issues=[];total=0
    for obj in p.objects(scene,stage):
        info=mesh_info(obj);total+=info['triangles'];bm=bmesh.new();bm.from_mesh(obj.data)
        nonman=sum(1 for e in bm.edges if not e.is_manifold);deg=sum(1 for f in bm.faces if f.calc_area()<1e-10);loose=sum(1 for v in bm.verts if not v.link_edges);bm.free()
        row={**info,'non_manifold_edges':nonman,'degenerate_faces':deg,'loose_vertices':loose}
        if nonman:issues.append({'severity':'warning','object':obj.name,'message':f'{nonman} arêtes non-manifold (peut être volontaire pour une surface ouverte).'})
        if deg:issues.append({'severity':'error','object':obj.name,'message':'Faces dégénérées.'})
        if not obj.data.uv_layers:issues.append({'severity':'warning','object':obj.name,'message':'Aucun UV.'})
        if any(x<0 for x in obj.scale):issues.append({'severity':'warning','object':obj.name,'message':'Échelle négative.'})
        rig=obj.find_armature()
        if rig:
            deform={g.index for g in obj.vertex_groups if g.name in rig.data.bones and rig.data.bones[g.name].use_deform}
            unweighted=over=unnorm=0
            for v in obj.data.vertices:
                weights=[g.weight for g in v.groups if g.group in deform and g.weight>1e-6]
                unweighted+=not weights;over+=len(weights)>4;unnorm+=bool(weights) and abs(sum(weights)-1)>.02
            row['skin']={'rig':rig.name,'unweighted_vertices':unweighted,'over_four_influences':over,'unnormalized_vertices':unnorm}
            if unweighted:issues.append({'severity':'error','object':obj.name,'message':f'{unweighted} sommets sans poids déformants.'})
            if over or unnorm:issues.append({'severity':'warning','object':obj.name,'message':'Normaliser les poids et limiter à quatre influences.'})
        rows.append(row)
    if not rows:issues.append({'severity':'error','message':'Aucun mesh à exporter.'})
    if total>budget:issues.append({'severity':'warning','message':f'Budget dépassé : {total} / {budget} triangles de base (modificateurs non comptés).'})
    for obj in p.objects(scene,stage):
        for mat in obj.data.materials:
            if not mat or not mat.use_nodes:continue
            for node in mat.node_tree.nodes:
                if node.type=='TEX_IMAGE' and node.image and not node.image.packed_file and node.image.source=='FILE' and not Path(bpy.path.abspath(node.image.filepath)).is_file():
                    issues.append({'severity':'error','object':obj.name,'message':'Texture absente : '+node.image.name})
    return {'passed':not any(x['severity']=='error' for x in issues),'stage':stage,'base_triangles':total,'budget':budget,'objects':rows,'issues':issues,
            'scope':'Contrôles structurels, pas de garantie de conformité artistique, retopologie ou animation.'}


def inspect_mesh(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    if action=='audit':
        report=audit(root,scene,s.get('stage','source'),int(s.get('triangle_budget',m.get('settings',{}).get('triangle_budget',50000))))
        file=scoped(root,m['run_dir']+'/qa/'+job['job_id']+'.json');atomic_json(file,report);report['report']=str(file);return report
    obj=owned(scene,s['object'],'MESH')
    if action=='object':return mesh_info(obj)
    if action=='geometry':
        start=int(number(s.get('offset',0),0,10000000));limit=int(number(s.get('limit',250),1,1000))
        return {'object':obj.name,'vertices':[{'index':v.index,'position':list(v.co)} for v in obj.data.vertices[start:start+limit]],
                'faces':[{'index':v.index,'vertices':list(v.vertices),'material':v.material_index} for v in obj.data.polygons[start:start+limit]],
                'edges':[{'index':v.index,'vertices':list(v.vertices),'seam':v.use_seam} for v in obj.data.edges[start:start+limit]],'offset':start,'limit':limit}
    raise ValueError('Action inconnue.')


def make_rig(scene,m,name,bones):
    if not 1<=len(bones)<=256:raise ValueError('1 à 256 os attendus.')
    known=set();validated=[]
    for bone in bones:
        name_b=str(bone['name'])
        if not name_b or len(name_b)>63 or name_b in known:raise ValueError('Nom d’os invalide ou dupliqué.')
        head,tail=vec(bone['head']),vec(bone['tail']);parent=bone.get('parent','')
        if (Vector(head)-Vector(tail)).length<1e-5:raise ValueError('Os de longueur nulle.')
        if parent and parent not in known:raise ValueError('Créer le parent avant son enfant : '+parent)
        validated.append((name_b,head,tail,parent,bone.get('deform',True)));known.add(name_b)
    data=bpy.data.armatures.new('EV_'+slug(name));rig=bpy.data.objects.new('EV_'+slug(name),data)
    bpy.data.collections[m['source_collection']].objects.link(rig);mark(rig,scene,'rig');rig.show_in_front=True
    p.select_only([rig]);bpy.ops.object.mode_set(mode='EDIT')
    try:
        for name_b,head,tail,parent,deform in validated:
            b=data.edit_bones.new(name_b);b.head=head;b.tail=tail;b.use_deform=deform
            if parent:b.parent=data.edit_bones[parent]
    finally:bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def rig_action(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    if action in ('create','humanoid'):
        if action=='humanoid':
            h=number(s.get('height',1.8),.1,20);center=Vector(vec(s.get('center',[0,0,0])));bones=[]
            def bone(name,a,b,parent='',deform=True):bones.append({'name':name,'head':list(center+Vector(a)*h),'tail':list(center+Vector(b)*h),'parent':parent,'deform':deform})
            bone('Root',(0,0,0),(0,0,.10),'',False)
            bone('Hips',(0,0,.49),(0,0,.56),'Root');bone('Spine',(0,0,.56),(0,0,.67),'Hips')
            bone('Chest',(0,0,.67),(0,0,.78),'Spine');bone('Neck',(0,0,.78),(0,0,.84),'Chest');bone('Head',(0,0,.84),(0,0,.98),'Neck')
            for sign,side in [(1,'L'),(-1,'R')]:
                bone('Shoulder.'+side,(0,0,.76),(sign*.12,0,.76),'Chest')
                bone('UpperArm.'+side,(sign*.12,0,.76),(sign*.30,0,.76),'Shoulder.'+side)
                bone('Forearm.'+side,(sign*.30,0,.76),(sign*.46,0,.76),'UpperArm.'+side)
                bone('Hand.'+side,(sign*.46,0,.76),(sign*.53,0,.76),'Forearm.'+side)
                bone('Thigh.'+side,(sign*.065,0,.49),(sign*.065,-.015,.27),'Hips')
                bone('Shin.'+side,(sign*.065,-.015,.27),(sign*.065,0,.055),'Thigh.'+side)
                bone('Foot.'+side,(sign*.065,0,.055),(sign*.065,-.11,.035),'Shin.'+side)
        else:bones=s['bones']
        rig=make_rig(scene,m,s['name'],bones);p.put_manifest(root,m)
        return {'rig':rig.name,'bones':[b.name for b in rig.data.bones],'note':'Squelette de départ : adapter aux proportions réelles.'}
    if action=='shape_key':
        obj=sources(scene,[s['object']])[0];offsets=[(int(c['index']),vec(c['delta'])) for c in s['offsets']]
        if any(i<0 or i>=len(obj.data.vertices) for i,_ in offsets):raise ValueError('Indice sommet invalide.')
        if not obj.data.shape_keys:obj.shape_key_add(name='Basis')
        if s['name'] in obj.data.shape_keys.key_blocks:raise ValueError('Shape key déjà présente.')
        key=obj.shape_key_add(name=slug(s['name']))
        for index,delta in offsets:key.data[index].co+=Vector(delta)
        key.value=number(s.get('value',0),0,1);invalidate(root,scene,m)
        return {'object':obj.name,'shape':key.name}
    if action=='weights':
        obj=sources(scene,[s['object']])[0];rig=obj.find_armature()
        if not rig:raise ValueError('Lier à un rig avant les poids.')
        checked=[]
        for entry in s['groups']:
            if entry['bone'] not in rig.data.bones:raise ValueError('Os inconnu.')
            vertices=[int(v) for v in entry['vertices']]
            if any(v<0 or v>=len(obj.data.vertices) for v in vertices):raise ValueError('Sommet invalide.')
            checked.append((entry['bone'],vertices,number(entry['weight'],0,1)))
        for name,vertices,weight in checked:
            group=obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name);group.add(vertices,weight,'REPLACE')
        p.select_only([obj])
        if s.get('limit',4):bpy.ops.object.vertex_group_limit_total(group_select_mode='BONE_DEFORM',limit=int(number(s.get('limit',4),1,8)))
        if s.get('normalize',True):bpy.ops.object.vertex_group_normalize_all(group_select_mode='BONE_DEFORM',lock_active=False)
        invalidate(root,scene,m);return mesh_info(obj)
    rig=owned(scene,s['rig'],'ARMATURE')
    if action=='bind':
        items=sources(scene,s['objects']);method=s.get('method','AUTO')
        if method not in ('AUTO','ENVELOPE','RIGID'):raise ValueError('Méthode de skinning inconnue.')
        if method=='RIGID' and s.get('bone') not in rig.data.bones:raise ValueError('Os de liaison absent.')
        if any(o.find_armature() for o in items):raise ValueError('Objet déjà riggué; corriger les poids sans le relier.')
        save_snapshot(root,scene,m,'avant_skinning')
        if method=='RIGID':
            for obj in items:
                world=obj.matrix_world.copy();obj.parent=rig;obj.matrix_world=world
                mod=obj.modifiers.new('EV_Armature','ARMATURE');mod.object=rig
                group=obj.vertex_groups.get(s['bone']) or obj.vertex_groups.new(name=s['bone']);group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
        else:
            p.select_only(items+[rig]);bpy.context.view_layer.objects.active=rig
            bpy.ops.object.parent_set(type='ARMATURE_AUTO' if method=='AUTO' else 'ARMATURE_ENVELOPE')
        invalidate(root,scene,m);return {'rig':rig.name,'objects':[o.name for o in items],'audit':audit(root,scene,'source',m.get('settings',{}).get('triangle_budget',50000))}
    if action=='ik':
        bone=rig.pose.bones.get(s['bone'])
        if not bone:raise ValueError('Os inconnu.')
        controls=[]
        for suffix,position in [('Target',s['target']),('Pole',s['pole'])]:
            ob=bpy.data.objects.new('EV_'+bone.name+'_'+suffix,None);scene.collection.objects.link(ob);ob.location=vec(position)
            ob.empty_display_type='SPHERE';ob.empty_display_size=.06;mark(ob,scene,'control');controls.append(ob)
        con=bone.constraints.new('IK');con.target=controls[0];con.pole_target=controls[1];con.chain_count=int(number(s.get('chain_length',2),1,8))
        return {'rig':rig.name,'bone':bone.name,'controls':[o.name for o in controls]}
    if action=='inspect':
        return {'rig':rig.name,'bones':[{'name':b.name,'head':list(b.head_local),'tail':list(b.tail_local),'parent':b.parent.name if b.parent else '', 'deform':b.use_deform} for b in rig.data.bones],
                'meshes':[o.name for o in p.objects(scene,'source') if o.find_armature()==rig]}
    raise ValueError('Action inconnue.')


def finish_action(target,action,name,start,end):
    ad=target.animation_data;slot=ad.action_slot
    track=ad.nla_tracks.new();track.name=name;strip=track.strips.new(name,int(start),action)
    if slot:strip.action_slot=slot
    strip.action_frame_start=start;strip.action_frame_end=max(start+1,end)
    track.mute=True;ad.action=None
    action.use_fake_user=True
    return track


def curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


def remove_clip(target,name):
    """Retire les pistes NLA du clip `name` et leurs actions devenues orphelines."""
    ad=target.animation_data;removed=0
    if not ad:return 0
    for track in [t for t in ad.nla_tracks if t.name==name]:
        actions=[strip.action for strip in track.strips if strip.action]
        ad.nla_tracks.remove(track);removed+=1
        for action in actions:
            if action.users==0:bpy.data.actions.remove(action)
    return removed


def create_clip(target,name,keys,frames,interpolation='LINEAR',shape=False):
    if not keys or len(keys)>10000:raise ValueError('1 à 10 000 clés attendues.')
    frames=int(number(frames,2,3600));checked=[]
    for key in keys:
        frame=int(number(key['frame'],0,frames));bone=key.get('bone','')
        if shape:
            if key['shape'] not in target.key_blocks:raise ValueError('Shape key absente.')
            checked.append((frame,key['shape'],{'value':number(key['value'],0,1)}));continue
        if bone and (target.type!='ARMATURE' or bone not in target.pose.bones):raise ValueError('Os inconnu : '+bone)
        values={k:vec(key[k]) for k in ('location','rotation_deg','scale') if k in key}
        if not values:raise ValueError('Clé sans transformation.')
        checked.append((frame,bone,values))
    target.animation_data_create();ad=target.animation_data;previous_action=ad.action;previous_slot=ad.action_slot
    action=bpy.data.actions.new('EV_'+slug(name));ad.action=action
    saved={}
    try:
        for frame,bone,values in checked:
            item=target.key_blocks[bone] if shape else target.pose.bones[bone] if bone else target
            if bone not in saved:
                saved[bone]=(item.value,) if shape else (item.location.copy(),item.rotation_euler.copy(),item.scale.copy(),item.rotation_mode)
            if not shape:item.rotation_mode='XYZ'
            for prop,value in values.items():
                if prop=='rotation_deg':prop='rotation_euler';value=[math.radians(x) for x in value]
                setattr(item,prop,value);item.keyframe_insert(data_path=prop,frame=frame,group=bone or 'Object')
        for fc in curves(action):
            for point in fc.keyframe_points:point.interpolation=interpolation
        finish_action(target,action,name,min(k[0] for k in checked),max(k[0] for k in checked))
    finally:
        ad.action=previous_action
        if previous_action and previous_slot:ad.action_slot=previous_slot
        for bone,value in saved.items():
            item=target.key_blocks[bone] if shape else target.pose.bones[bone] if bone else target
            if shape:item.value=value[0]
            else:item.location,item.rotation_euler,item.scale,item.rotation_mode=value
    return {'action':action.name,'clip':name,'frames':frames,'curves':sum(1 for _ in curves(action))}


def animation_action(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    if action=='list':
        clips=[]
        for obj in scene.objects:
            if obj.get('ev_run')!=scene['ev_run']:continue
            targets=[obj]+([obj.data.shape_keys] if obj.type=='MESH' and obj.data.shape_keys else [])
            for target in targets:
                if target.animation_data:
                    for track in target.animation_data.nla_tracks:
                        clips.append({'object':obj.name,'target':'shape_keys' if target!=obj else 'object','clip':track.name,
                                      'actions':[strip.action.name for strip in track.strips if strip.action]})
        return {'clips':clips,'frame':scene.frame_current,'fps':scene.render.fps}
    if action=='frame':scene.frame_set(int(number(s['frame'],0,100000)));return {'frame':scene.frame_current}
    if action=='pose':
        rig=owned(scene,s['rig'],'ARMATURE')
        for entry in s['bones']:
            pb=rig.pose.bones[entry['name']];pb.rotation_mode='XYZ'
            if 'rotation_deg' in entry:pb.rotation_euler=[math.radians(x) for x in vec(entry['rotation_deg'])]
            if 'location' in entry:pb.location=vec(entry['location'])
        bpy.context.view_layer.update();return {'rig':rig.name,'posed':True}
    if action=='preview':
        obj=owned(scene,s['object']);ad=obj.animation_data
        if not ad:raise ValueError('Objet sans animation.')
        track=next((t for t in ad.nla_tracks if t.name==s['name']),None)
        if not track:raise ValueError('Clip absent.')
        old_frame=scene.frame_current;states=[(t,t.mute) for t in ad.nla_tracks];old_action=ad.action
        images=[]
        try:
            ad.action=None
            for t in ad.nla_tracks:t.mute=t!=track
            for frame in s.get('frames',[1,15,30])[:8]:
                scene.frame_set(int(number(frame,0,3600)))
                result=preview(root,{'stage':s.get('stage','source'),'size':512,'single':True,'suffix':'frame_'+str(frame)},job)
                images+=result['images']
        finally:
            for t,mute in states:t.mute=mute
            ad.action=old_action;scene.frame_set(old_frame)
        return {'images':images,'clip':track.name}
    if action=='sample_cycle':
        rig=owned(scene,s['rig'],'ARMATURE');kind=s.get('kind','walk');frames=int(number(s.get('frames',30),4,240));amp=number(s.get('amplitude',25),1,70);keys=[]
        if kind not in ('walk','run','idle'):raise ValueError('Cycle inconnu.')
        for frame in range(1,frames+1,max(1,(frames-1)//8)):
            phase=2*math.pi*(frame-1)/(frames-1)
            for bone in rig.pose.bones:
                side=-1 if bone.name.endswith('.R') else 1
                angle=0
                if kind=='idle' and bone.name in ('Spine','Chest'):angle=math.sin(phase)*2
                elif kind!='idle':
                    if bone.name.startswith('Thigh'):angle=side*math.sin(phase)*amp
                    elif bone.name.startswith('Shin'):angle=max(0,-side*math.sin(phase))*amp*1.3
                    elif bone.name.startswith('UpperArm'):angle=-side*math.sin(phase)*amp*.6
                if angle or bone.name in ('Spine','Chest') or bone.name.startswith(('Thigh','Shin','UpperArm')):
                    keys.append({'frame':frame,'bone':bone.name,'rotation_deg':[angle,0,0]})
        # Exact closing key for a loop.
        keys.extend([{**k,'frame':frames} for k in keys[:] if k['frame']==1])
        result=create_clip(rig,s.get('name',kind),keys,frames);result['note']='Cycle procédural d’essai; pose, contacts et glissement des pieds à corriger.';return result
    if action in ('clip','shape_clip'):
        obj=owned(scene,s['object']);target=obj
        if action=='shape_clip':
            if obj.type!='MESH' or not obj.data.shape_keys:raise ValueError('Aucune shape key.')
            target=obj.data.shape_keys
        scene.render.fps=int(number(s.get('fps',scene.render.fps),1,120))
        # Recréer un clip du même nom le REMPLACE : sinon deux pistes portent le même nom, l'aperçu
        # joue l'ancienne et l'export livre les deux.
        replaced=remove_clip(target,s['name'])
        result=create_clip(target,s['name'],s['keys'],s.get('frames',60),s.get('interpolation','LINEAR'),action=='shape_clip')
        if replaced:result['replaced']=True
        return result
    if action=='delete':
        obj=owned(scene,s['object']);removed=remove_clip(obj,s['name'])
        if obj.type=='MESH' and obj.data.shape_keys:removed+=remove_clip(obj.data.shape_keys,s['name'])
        if not removed:raise ValueError('Clip absent.')
        return {'deleted':s['name'],'tracks':removed}
    raise ValueError('Action inconnue.')


def import_asset(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root);file=scoped(root,s['file'])
    if not file.is_file():raise ValueError('Fichier joint absent.')
    if action=='reference':
        if file.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'):raise ValueError('Image de référence attendue.')
        ob=bpy.data.objects.new('EV_REF_'+file.stem,None);scene.collection.objects.link(ob);mark(ob,scene,'reference')
        ob.empty_display_type='IMAGE';ob.data=bpy.data.images.load(str(file),check_existing=True);ob.empty_display_size=number(s.get('size',2),.01,100)
        ob.location=vec(s.get('location',[0,0,0]));view=s.get('view','front')
        angles={'front':(90,0,0),'back':(90,0,180),'left':(90,0,-90),'right':(90,0,90),'top':(0,0,0),'free':(0,0,0)}
        ob.rotation_euler=[math.radians(x) for x in angles[view]];ob.color[3]=.55;ob.empty_image_depth='BACK';ob.hide_render=True
        return {'reference':ob.name,'view':view}
    if action!='import':raise ValueError('Action inconnue.')
    ext=file.suffix.lower()
    if ext not in ('.glb','.fbx','.obj','.stl'):raise ValueError('GLB, FBX, OBJ ou STL attendu.')
    before=set(bpy.data.objects)
    if ext=='.glb':bpy.ops.import_scene.gltf(filepath=str(file))
    elif ext=='.fbx':bpy.ops.import_scene.fbx(filepath=str(file),use_image_search=False)
    elif ext=='.stl':bpy.ops.wm.stl_import(filepath=str(file))
    else:
        # OBJ attachments are geometry only; never follow external mtllib paths.
        clean='\n'.join(line for line in file.read_text(encoding='utf-8-sig').splitlines() if not line.lstrip().startswith(('mtllib ','usemtl ')))
        safe=scoped(root,m['run_dir']+'/imports/'+uuid.uuid4().hex+'.obj');safe.parent.mkdir(parents=True,exist_ok=True);safe.write_text(clean,encoding='utf-8')
        bpy.ops.wm.obj_import(filepath=str(safe))
    # glTF scene extras can overwrite our scene tags; restore project ownership.
    scene['ev_run']=m['run_id'];m['scene']=scene.name;p.activate(scene)
    helpers={pb.custom_shape for rig in scene.objects if rig.type=='ARMATURE' for pb in rig.pose.bones if pb.custom_shape}
    added=[o for o in scene.objects if o not in before and o not in helpers]
    for obj in added:
        p.move_to(obj,bpy.data.collections[m['source_collection']]);mark(obj,scene,'source' if obj.type=='MESH' else 'rig' if obj.type=='ARMATURE' else 'control')
        if obj.type=='MESH':
            if not obj.data.materials:obj.data.materials.append(mat_for(root,scene))
            if not obj.data.uv_layers:p.tile_uv(obj)
        elif obj.type not in ('ARMATURE','EMPTY'):obj.hide_render=True
    invalidate(root,scene,m)
    return {'imported':[mesh_info(o) for o in added],'animations':animation_action(root,{'action':'list','spec_json':'{}'},job)}


def preview(root,s,job):
    scene,m=p.scene_for(root);stage=s.get('stage','atlas' if m.get('atlas') else 'source')
    if stage not in ('source','atlas'):raise ValueError('Étape invalide.')
    items=p.objects(scene,stage)
    if not items:raise ValueError('Aucun mesh à rendre.')
    p.show_stage(scene,stage);bpy.context.view_layer.update();dg=bpy.context.evaluated_depsgraph_get()
    points=[o.matrix_world@Vector(c) for o in [x.evaluated_get(dg) for x in items] for c in o.bound_box]
    lo=Vector([min(v[i] for v in points) for i in range(3)]);hi=Vector([max(v[i] for v in points) for i in range(3)]);center=(lo+hi)/2
    radius=max((hi-lo).length,.1);scene.camera.data.type='ORTHO';scene.camera.data.ortho_scale=radius*1.25
    size=int(number(s.get('size',640),128,2048));scene.render.resolution_x=size;scene.render.resolution_y=size;scene.render.resolution_percentage=100
    scene.render.engine='CYCLES';scene.cycles.samples=m.get('settings',{}).get('render_samples',16);scene.cycles.device=m.get('settings',{}).get('render_device','CPU')
    if s.get('turntable'):
        count=int(number(s.get('frames',8),4,36));views=[('orbit_'+str(i),Vector((math.sin(i*2*math.pi/count)*2,-math.cos(i*2*math.pi/count)*2,1))) for i in range(count)]
    elif s.get('single'):views=[('hero',Vector((1.5,-2,1.2)))]
    else:views=[('front',Vector((0,-3,0))),('side',Vector((3,0,0))),('back',Vector((0,3,0))),('hero',Vector((1.5,-2,1.2)))]
    suffix=slug(s.get('suffix',uuid.uuid4().hex[:8]));folder=scoped(root,m['run_dir']+'/previews/studio_'+suffix);folder.mkdir(parents=True,exist_ok=True);images=[]
    for i,(label,direction) in enumerate(views):
        p.job_status(job,'Rendu '+label,(i+.1)/len(views));scene.camera.location=center+direction.normalized()*radius*2
        scene.camera.rotation_euler=(center-scene.camera.location).to_track_quat('-Z','Y').to_euler()
        scene.render.filepath=str(folder/(label+'.png'));bpy.ops.render.render(write_still=True);images.append(scene.render.filepath)
    m['preview_'+stage]=images;p.put_manifest(root,m);return {'images':images,'stage':stage,'frame':scene.frame_current}


def iso_render(root,s,job):
    # Une vue ISOMÉTRIQUE pour un jeu 2D (sprite) : caméra orthographique calée sur une projection
    # donnée, fond transparent, ombre portée sur le sol (shadow catcher). Les défauts sont ceux
    # d'Age of Ampyre (dimétrique 2:1, tuile 96×48, hauteurs ramenées à 44 px par mètre, image en miroir) : un
    # point monde (x,y,z) tombe au pixel (ox+(x-y)*48, oy+(x+y)*24-z*44).
    # Un mesh en dehors du cadre est coupé : régler width/height/origin_px.
    scene,m=p.scene_for(root);stage=s.get('stage','atlas' if m.get('atlas') else 'source')
    if stage not in ('source','atlas'):raise ValueError('Étape invalide.')
    items=p.objects(scene,stage)
    if not items:raise ValueError('Aucun mesh à rendre.')
    W=int(number(s.get('width',256),16,2048));H=int(number(s.get('height',256),16,2048))
    org=s.get('origin_px',[W/2,H*0.75])
    if not isinstance(org,(list,tuple)) or len(org)!=2:raise ValueError('origin_px : [x, y] attendu.')
    ox=number(org[0],-4096,4096);oy=number(org[1],-4096,4096)
    k=number(s.get('px_per_unit',48*math.sqrt(2)),1,2000)
    az=math.radians(number(s.get('azimuth_deg',45),-360,360));el=math.radians(number(s.get('elevation_deg',30),1,89))
    # `target` : cadrer UN objet. Les hauteurs ne sont alors pas écrasées (z_scale 1 par défaut, au
    # lieu du rapport 44 px/m d'Age of Ampyre, pensé pour une grille de tuiles et pas pour un objet).
    target=pick_named(items,[s['target']],'target')[0] if s.get('target') else None
    zs=number(s.get('z_scale',1 if target else 44/(k*math.cos(el))),0.05,20)
    flip=bool(s.get('flip_x',True));shadow=bool(s.get('shadow',True))
    # rotate_deg : tourne le modèle autour de Z (les 8 directions d'un sprite) sans le reconstruire.
    rot=math.radians(number(s.get('rotate_deg',0),-720,720))
    if target:
        # Projeter la boîte de l'objet (déformée comme au rendu) sur les axes de la caméra, puis
        # choisir l'échelle (sauf px_per_unit donné) et l'origine (sauf origin_px donné) qui la cadrent.
        Sz0=Matrix.Diagonal((1,1,zs,1))@Matrix.Rotation(rot,4,'Z')
        d0=Vector((math.cos(el)*math.cos(az),math.cos(el)*math.sin(az),math.sin(el)))
        q=(-d0).to_track_quat('-Z','Y');right=q@Vector((1,0,0));up=q@Vector((0,1,0))
        corners=[Sz0@(target.matrix_world@Vector(c)) for c in target.bound_box]
        us=[c.dot(right) for c in corners];vs=[c.dot(up) for c in corners]
        if 'px_per_unit' not in s:
            k=max(1.0,min(2000.0,min(.85*W/max(max(us)-min(us),1e-6),.85*H/max(max(vs)-min(vs),1e-6))))
        if 'origin_px' not in s:
            px=W/2-k*(min(us)+max(us))/2;oy=H/2+k*(min(vs)+max(vs))/2
            ox=(W-px) if flip else px
    # team_materials : seconde passe <name>_M.png, blanche là où ces matériaux sont VISIBLES (masque
    # de couleur d'équipe), transparente ailleurs.
    team=s.get('team_materials') or []
    if not isinstance(team,list) or not all(isinstance(t,str) for t in team):raise ValueError('team_materials : liste d’identifiants attendue.')
    name=slug(s.get('name','iso'))
    p.show_stage(scene,stage)
    cam=scene.camera
    saved={'res':(scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage),
           'transp':scene.render.film_transparent,'engine':scene.render.engine,
           'cam':(cam.location.copy(),cam.rotation_euler.copy(),cam.data.type,cam.data.ortho_scale,cam.data.shift_x,cam.data.shift_y,cam.data.clip_end)}
    roots=[o for o in items if o.parent is None or o.parent not in items]
    rigs=[o for o in scene.objects if o.type=='ARMATURE' and o.get('ev_run')==scene.get('ev_run')]
    lifted=roots+[r for r in rigs if r.parent is None]
    mats=[(o,o.matrix_world.copy()) for o in lifted]
    floor=next((o for o in scene.objects if o.name.startswith('EV_StudioFloor')),None);floor_state=(floor.is_shadow_catcher,floor.hide_render) if floor else None
    # LA LUMIÈRE DU JEU : un soleil dans la direction donnée (vers la lumière, coordonnées monde),
    # les lampes de studio éteintes — sinon l'ombre d'un sprite ne part pas du même côté que celle
    # des sprites déjà cuits. `sun: null` garde l'éclairage de studio.
    sun_dir=s.get('sun',[-0.75,-0.2,1.0]);sun=None
    studio=[o for o in scene.objects if o.type=='LIGHT' and o.name.startswith('EV_')]
    lights_state=[(o,o.hide_render) for o in studio]
    view_state=scene.view_settings.view_transform
    samples=int(number(s.get('samples',m.get('settings',{}).get('render_samples',16)),1,4096))
    # Avec `target`, les autres pièces du kit sont cachées au rendu (only_target:false pour les garder).
    hidden=[]
    if target and s.get('only_target',True):
        def under(o):
            while o is not None:
                if o is target:return True
                o=o.parent
            return False
        hidden=[(o,o.hide_render) for o in items if not under(o)]
    try:
        for o,_ in hidden:o.hide_render=True
        if sun_dir is not None:
            if not isinstance(sun_dir,(list,tuple)) or len(sun_dir)!=3:raise ValueError('sun : [x, y, z] attendu (vers la lumière).')
            for o in studio:o.hide_render=True
            sd=Vector([number(v,-100,100) for v in sun_dir]).normalized()
            sun=bpy.data.objects.new('EV_IsoSun',bpy.data.lights.new('EV_IsoSun','SUN'))
            scene.collection.objects.link(sun);sun.data.energy=number(s.get('sun_strength',4.0),0,100)
            sun.data.angle=math.radians(number(s.get('sun_angle_deg',3),0,90))
            sun.rotation_euler=(-sd).to_track_quat('-Z','Y').to_euler()
        try:scene.view_settings.view_transform='Standard'
        except TypeError:pass
        Sz=Matrix.Diagonal((1,1,zs,1))@Matrix.Rotation(rot,4,'Z')
        for o,mw in mats:o.matrix_world=Sz@mw
        if floor:floor.is_shadow_catcher=True;floor.hide_render=not shadow
        scene.render.engine='CYCLES';scene.render.film_transparent=True
        scene.render.resolution_x=W;scene.render.resolution_y=H;scene.render.resolution_percentage=100
        scene.cycles.samples=samples;scene.cycles.device=m.get('settings',{}).get('render_device','CPU')
        d=Vector((math.cos(el)*math.cos(az),math.cos(el)*math.sin(az),math.sin(el)))
        cam.data.type='ORTHO';cam.data.ortho_scale=max(W,H)/k;cam.data.clip_end=1000
        cam.location=d*100;cam.rotation_euler=(-d).to_track_quat('-Z','Y').to_euler()
        # Le point monde (0,0,0) au pixel voulu. Avant miroir, il est en (W-ox) si on retourne l'image.
        px=(W-ox) if flip else ox
        cam.data.shift_x=(W/2-px)/max(W,H);cam.data.shift_y=(oy-H/2)/max(W,H)
        p.job_status(job,'Rendu iso '+name,.2)
        folder=scoped(root,m['run_dir']+'/iso');folder.mkdir(parents=True,exist_ok=True)
        out=folder/(name+'.png');scene.render.filepath=str(out)
        bpy.ops.render.render(write_still=True)
        if flip:_flip_png(out,W,H)
        if team:
            p.job_status(job,'Masque d’équipe '+name,.7)
            mask_out=folder/(name+'_M.png');_team_mask(scene,items,set(team),floor,samples,mask_out)
            if flip:_flip_png(mask_out,W,H)
    finally:
        for o,h in hidden:o.hide_render=h
        for o,mw in mats:o.matrix_world=mw
        if floor:floor.is_shadow_catcher,floor.hide_render=floor_state
        for o,h in lights_state:o.hide_render=h
        if sun:
            data=sun.data;bpy.data.objects.remove(sun,do_unlink=True);bpy.data.lights.remove(data)
        scene.view_settings.view_transform=view_state
        scene.render.resolution_x,scene.render.resolution_y,scene.render.resolution_percentage=saved['res']
        scene.render.film_transparent=saved['transp'];scene.render.engine=saved['engine']
        c=saved['cam'];cam.location,cam.rotation_euler=c[0],c[1]
        cam.data.type,cam.data.ortho_scale,cam.data.shift_x,cam.data.shift_y,cam.data.clip_end=c[2],c[3],c[4],c[5],c[6]
    res={'images':[str(out)],'image':str(out),'width':W,'height':H,'origin_px':[ox,oy],'stage':stage,
         'px_per_unit':k,'z_scale':zs}
    if target:res['target']=target.name
    if team:res['mask']=str(mask_out)
    return res


def _flip_png(path,W,H):
    img=bpy.data.images.load(str(path),check_existing=False)
    a=np.array(img.pixels[:],dtype=np.float32).reshape(H,W,4)[:,::-1,:]
    img.pixels[:]=a.ravel();img.filepath_raw=str(path);img.file_format='PNG';img.save()
    bpy.data.images.remove(img)


def _team_mask(scene,items,team,floor,samples,out):
    # Matériaux d'équipe en émission blanche, tout le reste en « holdout » (transparent, mais il
    # cache ce qui est derrière) : le masque ne garde que la couleur d'équipe VISIBLE.
    white=bpy.data.materials.new('EV_TeamWhite');white.use_nodes=True;nt=white.node_tree;nt.nodes.clear()
    em=nt.nodes.new('ShaderNodeEmission');em.inputs['Color'].default_value=(1,1,1,1);em.inputs['Strength'].default_value=1
    o1=nt.nodes.new('ShaderNodeOutputMaterial');nt.links.new(em.outputs[0],o1.inputs[0])
    hold=bpy.data.materials.new('EV_TeamHoldout');hold.use_nodes=True;nh=hold.node_tree;nh.nodes.clear()
    ho=nh.nodes.new('ShaderNodeHoldout');o2=nh.nodes.new('ShaderNodeOutputMaterial');nh.links.new(ho.outputs[0],o2.inputs[0])
    saved=[];floor_h=floor.hide_render if floor else None
    try:
        if floor:floor.hide_render=True
        for o in items:
            slots=[sl.material for sl in o.material_slots];saved.append((o,slots))
            for i,sl in enumerate(o.material_slots):
                mid=sl.material.get('ev_material_id') if sl.material else None
                sl.material=white if mid in team else hold
        scene.cycles.samples=max(4,min(samples,16));scene.render.filepath=str(out)
        bpy.ops.render.render(write_still=True)
    finally:
        for o,slots in saved:
            for sl,m in zip(o.material_slots,slots):sl.material=m
        if floor:floor.hide_render=floor_h
        bpy.data.materials.remove(white);bpy.data.materials.remove(hold)


def delivery_action(root,args,job):
    action,s=spec(args);scene,m=p.scene_for(root)
    if action=='preview':return preview(root,s,job)
    if action=='iso':return iso_render(root,s,job)
    if action=='turntable':return preview(root,{**s,'turntable':True},job)
    if action=='texture_bake':
        obj=sources(scene,[s['object']])[0];size=int(number(s.get('size',1024),256,4096))
        if s.get('channels',['AO'])!=['AO']:raise ValueError('Baking séparé : AO uniquement ; PBR complet via build_atlas.')
        if not obj.data.uv_layers:raise ValueError('Déplier les UV avant le bake AO.')
        image=bpy.data.images.new('EV_AO',width=size,height=size,alpha=True);image.colorspace_settings.name='Non-Color';nodes=[]
        try:
            for mat in obj.data.materials:
                if not mat or not mat.use_nodes:raise ValueError('Matériau à nodes requis.')
                node=mat.node_tree.nodes.new('ShaderNodeTexImage');node.image=image;mat.node_tree.nodes.active=node;nodes.append((mat.node_tree,node))
            p.select_only([obj]);scene.render.engine='CYCLES';scene.cycles.samples=16
            bpy.ops.object.bake(type='AO',use_clear=True,margin=8)
            file=scoped(root,m['run_dir']+'/bakes/'+obj.name+'_AO_'+job['job_id'][:8]+'.png');p.save_image(image,file)
        finally:
            for tree,node in nodes:tree.nodes.remove(node)
        return {'image':str(file),'channel':'AO','uv':obj.data.uv_layers.active.name}
    if action!='export':raise ValueError('Action inconnue.')
    stage=s.get('stage','atlas' if m.get('atlas') else 'source')
    if stage not in ('source','atlas'):raise ValueError('Étape invalide.')
    if stage=='atlas' and not m.get('atlas'):raise ValueError('Atlas invalidé ou absent; reconstruire avant export.')
    items=p.objects(scene,stage)
    # `objects` : n'exporter qu'un élément d'un kit, sans supprimer le reste de la scène.
    if s.get('objects') is not None:items=pick_named(items,s['objects'])
    report=audit(root,scene,stage,m.get('settings',{}).get('triangle_budget',50000))
    if not report['passed']:raise ValueError('QA bloquante : '+json.dumps([e for e in report['issues'] if e['severity']=='error'],ensure_ascii=False))
    formats=s.get('formats',['GLB','FBX'])
    if any(f not in ('GLB','FBX','OBJ') for f in formats):raise ValueError('Format inconnu.')
    label=slug(s.get('name','Asset'));folder=scoped(root,m['run_dir']+'/deliveries/'+job['job_id'][:8]);folder.mkdir(parents=True,exist_ok=True)
    p.show_stage(scene,stage);rigs=list({o.find_armature() for o in items if o.find_armature()})
    controls=[o for o in scene.objects if o.get('ev_role')=='control' and o.get('ev_run')==scene['ev_run']]
    if s.get('objects') is not None and not rigs:controls=[]   # un élément statique n'emporte pas les contrôles
    selected=items+rigs+controls;animated=bool(s.get('animations',True));states=[]
    # `origin` : le pivot du GLB. Les racines exportées sont décalées LE TEMPS DE L'EXPORT, puis remises.
    pivot=export_pivot(s.get('origin'),items);shifted=[]
    if pivot is not None:
        shift=Matrix.Translation(-pivot)
        for ob in selected:
            if ob.parent is None or ob.parent not in selected:shifted.append((ob,ob.matrix_world.copy()))
        for ob,mw in shifted:ob.matrix_world=shift@mw
        bpy.context.view_layer.update()
    for ob in selected:
        targets=[ob]+([ob.data.shape_keys] if ob.type=='MESH' and ob.data.shape_keys else [])
        for target in targets:
            ad=target.animation_data
            if ad:
                states.append((ad,ad.action,ad.action_slot,[(t,t.mute) for t in ad.nla_tracks]));ad.action=None
                for track in ad.nla_tracks:track.mute=not animated
    output=[]
    def glb(file,selection,animations=animated):
        p.select_only(selection)
        bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,use_active_scene=True,
            export_animations=animations,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_skins=True,
            export_influence_nb=4,export_morph=True,export_extras=True,export_yup=True)
        output.append(str(file))
    try:
        if 'GLB' in formats:glb(folder/(label+'.glb'),selected)
        if 'FBX' in formats:
            p.select_only(selected);file=folder/(label+'.fbx')
            bpy.ops.export_scene.fbx(filepath=str(file),use_selection=True,object_types={'MESH','ARMATURE','EMPTY'},
                axis_forward='-Z',axis_up='Y',add_leaf_bones=False,path_mode='COPY',embed_textures=True,
                bake_anim=animated,bake_anim_use_all_actions=False,bake_anim_use_nla_strips=True,bake_anim_simplify_factor=0)
            output.append(str(file))
        if 'OBJ' in formats:
            p.select_only(items);file=folder/(label+'.obj');bpy.ops.wm.obj_export(filepath=str(file),export_selected_objects=True,forward_axis='NEGATIVE_Z',up_axis='Y');output.append(str(file))
        if s.get('individual',True) and 'GLB' in formats:
            for obj in items:
                associated=[obj]+([obj.find_armature()]+controls if obj.find_armature() else [])
                glb(folder/(obj.name+'.glb'),associated)
        static=[o for o in items if not o.find_armature() and not o.data.shape_keys]
        ratios=s.get('lod_ratios',[])
        if len(ratios)>3:raise ValueError('Maximum trois LOD.')
        for level,ratio in enumerate(ratios,1):
            ratio=number(ratio,.05,.99);copies=[]
            try:
                for orig in static:
                    obj=orig.copy();obj.data=orig.data.copy();obj.animation_data_clear();scene.collection.objects.link(obj);mark(obj,scene,'lod');obj.name=orig.name+'_LOD'+str(level)
                    p.select_only([obj]);mod=obj.modifiers.new('EV_LOD','DECIMATE');mod.ratio=ratio;bpy.ops.object.modifier_apply(modifier=mod.name);copies.append(obj)
                if copies and 'GLB' in formats:glb(folder/(label+'_LOD'+str(level)+'.glb'),copies,False)
            finally:
                for obj in copies:bpy.data.objects.remove(obj,do_unlink=True)
        if s.get('collisions'):
            hulls=[]
            try:
                for orig in items:
                    mesh=bpy.data.meshes.new('Collision');bm=bmesh.new()
                    for v in orig.data.vertices:bm.verts.new(orig.matrix_world@v.co)
                    result=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
                    discard=list(set(result.get('geom_interior',[])+result.get('geom_unused',[])))
                    if discard:bmesh.ops.delete(bm,geom=discard,context='VERTS')
                    bm.to_mesh(mesh);bm.free();obj=bpy.data.objects.new('UCX_'+orig.name,mesh);scene.collection.objects.link(obj);mark(obj,scene,'collision');hulls.append(obj)
                glb(folder/(label+'_Collisions.glb'),hulls,False)
            finally:
                for obj in hulls:bpy.data.objects.remove(obj,do_unlink=True)
    finally:
        for ob,mw in shifted:ob.matrix_world=mw
        if shifted:bpy.context.view_layer.update()
        for ad,active,slot,tracks in states:
            ad.action=active
            if active and slot:ad.action_slot=slot
            for track,mute in tracks:track.mute=mute
        p.show_stage(scene,stage)
    checkpoint=p.checkpoint(root,scene,m['run_dir'],'delivery_'+job['job_id'][:8]);output.append(checkpoint)
    result={'files':output,'stage':stage,'objects':[o.name for o in items],'rigs':[o.name for o in rigs],
            'animations':animation_action(root,{'action':'list','spec_json':'{}'},job)['clips'],
            'origin':(s.get('origin') or 'keep'),'pivot_world':list(pivot) if pivot is not None else None,
            'qa':report,'lod_skipped_skinned':[o.name for o in items if o not in static],
            'notes':['Unity : assigner/configurer les matériaux selon le pipeline; contrôler les morphs et clips après import, GLB recommandé pour vérifier les morph targets.',
                     'Colliders fournis séparément. Aucun LODGroup ou Avatar Unity configuré automatiquement.',
                     'Les matériaux procéduraux exigent un baking avant export fidèle.']}
    atomic_json(folder/'asset_manifest.json',result);m['exports']=output;p.put_manifest(root,m)
    return result


BASE_MATERIAL_FACTORY=p.material_from_entry
BASE_ATLAS=p.build_atlas

def atlas_rest_pose(root,args,job):
    scene,m=p.scene_for(root)
    rigs=[o for o in scene.objects if o.type=='ARMATURE' and o.get('ev_run')==scene['ev_run']]
    positions=[(o,o.data.pose_position) for o in rigs]
    shapes=[(k,k.value) for o in p.objects(scene,'source') if o.data.shape_keys for k in o.data.shape_keys.key_blocks]
    try:
        for rig,_ in positions:rig.data.pose_position='REST'
        for key,_ in shapes:key.value=0
        bpy.context.view_layer.update()
        # Atlas V2 handles albedo, roughness, metallic and normal. Avoid silent loss of emission.
        for obj in p.objects(scene,'source'):
            for mat in obj.data.materials:
                if not mat or not mat.use_nodes:continue
                for node in mat.node_tree.nodes:
                    if node.type=='BSDF_PRINCIPLED':
                        emission=node.inputs['Emission Color'];strength=node.inputs['Emission Strength']
                        if strength.is_linked or (strength.default_value>0 and (emission.is_linked or max(emission.default_value[:3])>0)):
                            raise ValueError('Atlas émissif non pris en charge dans cette version : exporter la source avec ses cartes PBR ou désactiver l’émission avant baking.')
        return BASE_ATLAS(root,args,job)
    finally:
        for rig,position in positions:rig.data.pose_position=position
        for key,value in shapes:key.value=value
        bpy.context.view_layer.update()


def install():
    p.material_from_entry=material_from_record
    p.build_atlas=atlas_rest_pose
    p.OPERATIONS["build_atlas"]=atlas_rest_pose
    for name in ('project_action','model_geometry','material_action','uv_action','rig_action','animation_action','inspect_mesh','import_asset','delivery_action'):
        p.OPERATIONS[name]=globals()[name]
