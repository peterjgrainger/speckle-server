import * as THREE from 'three'
import { BufferGeometryUtils } from 'three/examples/jsm/utils/BufferGeometryUtils'
import ObjectWrapper from './ObjectWrapper'
import { getConversionFactor } from './Units'

/**
 * Utility class providing some top level conversion methods.
 * Warning: HIC SVNT DRACONES.
 */
export default class Coverter {

  constructor( objectLoader ) {
    if ( !objectLoader ) {
      console.warn( 'Converter initialized without a corresponding object loader. Any objects that include references will throw errors.' )
    }

    this.objectLoader = objectLoader
    this.curveSegmentLength = 0.1
  }

  /**
   * If the object is convertable (there is a direct conversion routine), it will invoke the callback with the conversion result.
   * If the object is not convertable, it will recursively iterate through it (arrays & objects) and invoke the callback on any postive conversion result.
   * @param  {[type]}   obj      [description]
   * @param  {Function} callback [description]
   * @return {[type]}            [description]
   */
  async traverseAndConvert( obj, callback ) {
    // Exit on primitives (string, ints, bools, bigints, etc.)
    if ( typeof obj !== 'object' ) return
    if ( obj.referencedId ) obj = await this.resolveReference( obj )

    let childrenConversionPromisses = []

    // Traverse arrays, and exit early (we don't want to iterate through many numbers)
    if ( Array.isArray( obj ) ) {
      for ( let element of obj ) {
        if ( typeof element !== 'object' ) break // exit early for non-object based arrays
        let childPromise = this.traverseAndConvert( element, callback )
        childrenConversionPromisses.push( childPromise )
      }
      await Promise.all( childrenConversionPromisses )
      return
    }

    // If we can convert it, we should invoke the respective conversion routine.
    const type = this.getSpeckleType( obj )
    if ( this[`${type}ToBufferGeometry`] ) {
      try {
        callback( await this[`${type}ToBufferGeometry`]( obj.data || obj ) )
        return
      } catch ( e ) {
        console.warn( `(Traversing - direct) Failed to convert ${type} with id: ${obj.id}`, e )
      }
    }

    let target = obj.data || obj

    // Check if the object has a display value of sorts
    let displayValue = target['displayMesh'] || target['@displayMesh'] || target['displayValue']|| target['@displayValue']
    if ( displayValue ) {
      if ( !Array.isArray( displayValue ) ) {
        displayValue = await this.resolveReference( displayValue )
        if ( !displayValue.units ) displayValue.units = obj.units
        try {
          let { bufferGeometry } = await this.convert( displayValue )
          callback( new ObjectWrapper( bufferGeometry, obj ) ) // use the parent's metadata!
        } catch ( e ) {
          console.warn( `(Traversing) Failed to convert obj with id: ${obj.id} — ${e.message}` )
        }
      } else {
        for ( let element of displayValue ) {
          let val = await this.resolveReference( element )
          if ( !val.units ) val.units = obj.units
          let { bufferGeometry } = await this.convert( val )
          callback( new ObjectWrapper( bufferGeometry, { renderMaterial: val.renderMaterial } ) )
        }
      }
    }

    // If this is a built element and has a display value, only iterate through the "elements" prop if it exists.
    if ( displayValue && obj.speckle_type.toLowerCase().includes( 'builtelements' ) ) {
      if ( obj['elements'] ) {
        childrenConversionPromisses.push( this.traverseAndConvert( obj['elements'], callback ) )
        await Promise.all( childrenConversionPromisses )
      }
      return
    }

    // Last attempt: iterate through all object keys and see if we can display anything!
    // traverses the object in case there's any sub-objects we can convert.
    for ( let prop in target ) {
      if ( typeof target[prop] !== 'object' ) continue
      let childPromise = this.traverseAndConvert( target[prop], callback )
      childrenConversionPromisses.push( childPromise )
    }
    await Promise.all( childrenConversionPromisses )
  }

  /**
   * Directly converts an object and invokes the callback with the the conversion result.
   * If you don't know what you're doing, use traverseAndConvert() instead.
   * @param  {[type]} obj [description]
   * @param  {Function} callback [description]
   * @return {[type]}     [description]
   */
  async convert( obj ) {
    if ( obj.referencedId ) obj = await this.resolveReference( obj )
    try {
      let type = this.getSpeckleType( obj )
      if ( this[`${type}ToBufferGeometry`] ) {
        return await this[`${type}ToBufferGeometry`]( obj.data || obj )
      }
      else return null
    } catch ( e ) {
      console.log( obj )
      console.warn( `(Direct convert) Failed to convert object with id: ${obj.id}` )
      throw e
    }
  }

  /**
   * Takes an array composed of chunked references and dechunks it.
   * @param  {[type]} arr [description]
   * @return {[type]}     [description]
   */
  async dechunk( arr ) {
    if ( !arr ) return arr
    // Handles pre-chunking objects, or arrs that have not been chunked
    if ( !arr[0].referencedId ) return arr

    let dechunked = []
    for ( let ref of arr ) {
      let real = await this.objectLoader.getObject( ref.referencedId )
      dechunked.push( ...real.data )
    }
    return dechunked
  }

  /**
   * Resolves an object reference by waiting for the loader to load it up.
   * @param  {[type]} obj [description]
   * @return {[type]}     [description]
   */
  async resolveReference( obj ) {
    if ( obj.referencedId )
      return await this.objectLoader.getObject( obj.referencedId )
    else return obj
  }

  /**
   * Gets the speckle type of an object in various scenarios.
   * @param  {[type]} obj [description]
   * @return {[type]}     [description]
   */
  getSpeckleType( obj ) {
    let type = 'Base'
    if ( obj.data )
      type = obj.data.speckle_type ? obj.data.speckle_type.split( '.' ).reverse()[0] : type
    else
      type = obj.speckle_type ? obj.speckle_type.split( '.' ).reverse()[0] : type
    return type
  }

  async BrepToBufferGeometry( obj ) {
    try {
      if ( !obj ) return
      let { bufferGeometry } = await this.MeshToBufferGeometry( await this.resolveReference( obj.displayValue || obj.displayMesh ) )

      // deletes known uneeded fields
      delete obj.displayMesh
      delete obj.displayValue
      delete obj.Edges
      delete obj.Faces
      delete obj.Loops
      delete obj.Trims
      delete obj.Curve2D
      delete obj.Curve3D
      delete obj.Surfaces
      delete obj.Vertices

      return new ObjectWrapper( bufferGeometry, obj )
    } catch ( e ) {
      console.warn( `Failed to convert brep id: ${obj.id}` )
      throw e
    }
  }

  async MeshToBufferGeometry( obj ) {
    try {
      if ( !obj ) return

      let conversionFactor = getConversionFactor( obj.units )
      let buffer = new THREE.BufferGeometry( )
      let indices = [ ]

      let vertices = await this.dechunk( obj.vertices )
      let faces = await this.dechunk( obj.faces )

      let k = 0
      while ( k < faces.length ) {
        if ( faces[ k ] === 1 ) { // QUAD FACE
          indices.push( faces[ k + 1 ], faces[ k + 2 ], faces[ k + 3 ] )
          indices.push( faces[ k + 1 ], faces[ k + 3 ], faces[ k + 4 ] )
          k += 5
        } else if ( faces[ k ] === 0 ) { // TRIANGLE FACE
          indices.push( faces[ k + 1 ], faces[ k + 2 ], faces[ k + 3 ] )
          k += 4
        } else throw new Error( `Mesh type not supported. Face topology indicator: ${faces[k]}` )
      }
      buffer.setIndex( indices )

      buffer.setAttribute(
        'position',
        new THREE.Float32BufferAttribute( conversionFactor === 1 ? vertices : vertices.map( v => v * conversionFactor ), 3 ) )

      buffer.computeVertexNormals( )
      buffer.computeFaceNormals( )
      buffer.computeBoundingSphere( )

      delete obj.vertices
      delete obj.faces

      return new ObjectWrapper( buffer, obj )
    } catch ( e ) {
      console.warn( `Failed to convert mesh with id: ${obj.id}` )
      throw e
    }
  }

  PointToVector3( obj ) {
    let conversionFactor = getConversionFactor( obj.units )
    let v = null
    if ( obj.value ) {
      // Old point format based on value list
      v = new THREE.Vector3( obj.value[0]* conversionFactor,obj.value[1]* conversionFactor,obj.value[2] * conversionFactor )
    } else {
      // New point format based on cartesian coords
      v = new THREE.Vector3( obj.x * conversionFactor, obj.y * conversionFactor, obj.z * conversionFactor )
    }
    return v
  }

  // TODOs:
  async PointToBufferGeometry( obj ) {
    let v = this.PointToVector3( obj )
    let buf = new THREE.BufferGeometry().setFromPoints( [ v ] )

    delete obj.value
    delete obj.speckle_type
    delete obj.bbox

    return new ObjectWrapper( buf, obj, 'point' )
  }

  async LineToBufferGeometry( object ) {
    if ( object.value ){
      //Old line format, treat as polyline
      return this.PolylineToBufferGeometry( object )
    }
    let obj = {}
    Object.assign( obj, object )

    delete object.start
    delete object.end
    delete object.speckle_type
    delete object.bbox

    const geometry = new THREE.BufferGeometry().setFromPoints( [ this.PointToVector3( obj.start ), this.PointToVector3( obj.end ) ] )

    return new ObjectWrapper( geometry, obj, 'line' )
  }

  async PolylineToBufferGeometry( object ) {
    let obj = {}
    Object.assign( obj, object )

    delete object.value
    delete object.speckle_type
    delete object.bbox

    let conversionFactor = getConversionFactor( obj.units )

    obj.value = await this.dechunk( obj.value )

    const points = []
    for ( let i = 0; i < obj.value.length; i+=3 ) {
      points.push( new THREE.Vector3( obj.value[i]* conversionFactor,obj.value[i+1]* conversionFactor,obj.value[i+2] * conversionFactor ) )
    }
    if ( obj.closed )
      points.push( points[0] )

    const geometry = new THREE.BufferGeometry().setFromPoints( points )

    delete obj.value
    delete obj.bbox

    return new ObjectWrapper( geometry, obj, 'line' )
  }

  async PolycurveToBufferGeometry( object ) {
    let obj = {}
    Object.assign( obj, object )

    delete object.value
    delete object.speckle_type
    delete object.displayValue
    delete object.segments
    delete object.bbox

    let buffers = []
    for ( let i = 0; i < obj.segments.length; i++ ) {
      const element = obj.segments[i]
      const conv = await this.convert( element )
      buffers.push( conv?.bufferGeometry )
    }
    let geometry = BufferGeometryUtils.mergeBufferGeometries( buffers )

    delete obj.segments
    delete obj.speckle_type
    delete obj.bbox

    return new ObjectWrapper( geometry , obj, 'line' )
  }

  async CurveToBufferGeometry( object ) {

    let obj = {}
    Object.assign( obj, object )

    delete object.value
    delete object.speckle_type
    delete object.displayValue
    delete object.bbox

    obj.weights = await this.dechunk( object.weights )
    obj.knots = await this.dechunk( object.knots )
    obj.points = await this.dechunk( object.points )

    const poly = await this.PolylineToBufferGeometry( obj.displayValue )

    delete obj.speckle_type
    delete obj.displayValue
    delete obj.points
    delete obj.weights
    delete obj.knots
    delete obj.bbox

    return new ObjectWrapper( poly.bufferGeometry, obj, 'line' )
  }

  async CircleToBufferGeometry( obj ) {
    let conversionFactor = getConversionFactor( obj.units )
    const points = this.getCircularCurvePoints( obj.plane, obj.radius * conversionFactor )
    const geometry = new THREE.BufferGeometry().setFromPoints( points )

    delete obj.plane
    delete obj.value
    delete obj.speckle_type
    delete obj.bbox

    return new ObjectWrapper( geometry, obj, 'line' )
  }

  PlaneToMatrix4( plane ){
    const m = new THREE.Matrix4()
    console.warn( 'plane', plane )
    let conversionFactor = getConversionFactor( plane.units )

    m.makeBasis( this.PointToVector3( plane.xdir ).normalize(), this.PointToVector3( plane.ydir ).normalize(), this.PointToVector3( plane.normal ).normalize() )
    m.setPosition( this.PointToVector3( plane.origin ) )
    m.scale( new THREE.Vector3( conversionFactor,conversionFactor,conversionFactor ) )
    return m
  }
  
  async ArcToBufferGeometry( obj ) {
    let conversionFactor = getConversionFactor( obj.units )
    // const points = this.getCircularCurvePoints( obj.plane, obj.radius * conversionFactor, obj.startAngle, obj.endAngle )
    //const geometry = new THREE.BufferGeometry().setFromPoints( points )
    const radius = obj.radius
    console.warn( 'factor', conversionFactor, radius, radius*conversionFactor )
    const curve = new THREE.EllipseCurve(
      0,0,            // ax, aY
      radius, radius,           // xRadius, yRadius
      obj.startAngle, obj.endAngle,  // aStartAngle, aEndAngle
      false,            // aClockwise
      0                 // aRotation
    )
    const points = curve.getPoints( 50 )
    const geometry = new THREE.BufferGeometry().setFromPoints( points ).applyMatrix4( this.PlaneToMatrix4( obj.plane ) )
    delete obj.speckle_type
    delete obj.startPoint
    delete obj.endPoint
    delete obj.plane
    delete obj.midPoint
    delete obj.bbox

    return new ObjectWrapper( geometry, obj, 'line' )
  }
  getCircularCurvePoints( plane, radius, startAngle = 0, endAngle = 2*Math.PI, res = this.curveSegmentLength ) {

    // Get alignment vectors
    const center = this.PointToVector3( plane.origin )
    const xAxis = this.PointToVector3( plane.xdir )
    const yAxis = this.PointToVector3( plane.ydir )

    // Make sure plane axis are unit lenght!!!!
    xAxis.normalize()
    yAxis.normalize()

    
    // Determine resolution
    let resolution = ( endAngle - startAngle ) * radius / res
    resolution = parseInt( resolution.toString() )

    let points = []

    for ( let index = 0; index <= resolution; index++ ) {
      let t = startAngle + index * ( endAngle - startAngle ) / resolution
      let x = Math.cos( t ) * radius
      let y = Math.sin( t ) * radius
      const xMove = new THREE.Vector3( xAxis.x * x, xAxis.y * x, xAxis.z * x )
      const yMove = new THREE.Vector3( yAxis.x * y, yAxis.y * y, yAxis.z * y )

      const pt = new THREE.Vector3().addVectors( xMove, yMove ).add( center )
      points.push( pt )
    }
    return points
  }

  async EllipseToBufferGeometry( obj ) {
    const conversionFactor = getConversionFactor( obj.units )

    const center = new THREE.Vector3( obj.plane.origin.x  ,obj.plane.origin.y ,obj.plane.origin.z   ).multiplyScalar( conversionFactor )
    const xAxis = new THREE.Vector3( obj.plane.xdir.x,obj.plane.xdir.y,obj.plane.xdir.z ).normalize()
    const yAxis = new THREE.Vector3( obj.plane.ydir.x ,obj.plane.ydir.y,obj.plane.ydir.z  ).normalize()
    

    let resolution = 2 * Math.PI * obj.firstRadius * conversionFactor * 10
    resolution = parseInt( resolution.toString() )
    let points = []

    for ( let index = 0; index <= resolution; index++ ) {
      let t = index * Math.PI * 2 / resolution
      let x = Math.cos( t ) * obj.firstRadius * conversionFactor
      let y = Math.sin( t ) * obj.secondRadius * conversionFactor
      const xMove = new THREE.Vector3( xAxis.x * x, xAxis.y * x, xAxis.z * x )
      const yMove = new THREE.Vector3( yAxis.x * y, yAxis.y * y, yAxis.z * y )

      let pt = new THREE.Vector3().addVectors( xMove, yMove ).add( center )
      points.push( pt )
    }

    const geometry = new THREE.BufferGeometry().setFromPoints( points )

    delete obj.value
    delete obj.speckle_type
    delete obj.plane

    return new ObjectWrapper( geometry, obj, 'line' )
  }
}
