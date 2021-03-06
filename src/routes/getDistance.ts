import express, { NextFunction, Request, Response } from 'express';
const router = express.Router();
const redis = require('redis')
const client = redis.createClient()
const geo = require('georedis').initialize(client)
import { getLocation } from '../db/index'
import type {Coordinates, DistanceData} from '../types'


//get distance if redis DB has location records, otherwise return data to validate record in postgres DB
const getLocations = (placeOne: string, placeTwo: string, unit: string)=> new Promise<DistanceData> ((resolve, reject)=>{
    geo.locations([placeOne, placeTwo], (err: Error, locations: Record<string, Coordinates> ) => {
        const places: Array<string> = []
        if(err) reject(err)
        else if ( locations[`${placeOne}`] != null && locations[placeTwo] != null ) {
            geo.distance(placeOne, placeTwo, {units:unit}, (err: Error, distance: number)=>{
             if (err) reject(err)
             else resolve({distance, places})
            })
        } else {
            if (locations[`${placeOne}`] == null) places.push(placeOne)
            if (locations[`${placeTwo}`] == null) places.push(placeTwo)
            resolve({distance:null, places})
        }
        
      })
})


router.get('/', async (req: Request, res: Response, next: NextFunction) => {
     const placeOne = req.query["place-one"]
     const placeTwo = req.query["place-two"]
     const unit = req.query.unit
     let distance = null
     
     try{
     //try to get distance from redis DB location records    
     const distanceData = await getLocations(`${placeOne}`, `${placeTwo}`, `${unit}`)
    
     if (distanceData.distance != null){
         distance = distanceData.distance
     }else {
     // if any location record is not found in redis DB, try to get location record from postgres DB and put it in redis DB
         await Promise.all(
           distanceData.places.map( async (place: string)=> { 
             const currentPlace = await getLocation(place)
               if( currentPlace != undefined){
                    geo.addLocation(currentPlace.name, { latitude:currentPlace.latitude, longitude:currentPlace.longitude }, (err: Error, reply: Record<string, number>) =>{
                        if(err) { 
                        console.error(err)
                        return next(err);
                        }
                        else console.log('added locations:', reply)
                    })
               }
           })
         )
      //get distance from postgres DB records if missing in redis
         const distDataReviewed = await getLocations(`${placeOne}`, `${placeTwo}`, `${unit}`)
         if (distDataReviewed.distance != null) distance = distDataReviewed.distance

    }}
    catch(error){
      console.error(error)
      return next(error);
    }


    res.send({
        unit, 
        distance
    })
    
})

module.exports = router