//
//  HealthKitPlugin.m
//  BackNine
//
//  Objective-C bridge registering HealthKitPlugin with Capacitor.
//  The JS name "CapacitorHealthkit" is what our TypeScript looks up
//  at window.Capacitor.Plugins.CapacitorHealthkit — the JS side of
//  the app doesn't need to change.
//

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(HealthKitPlugin, "CapacitorHealthkit",
    CAP_PLUGIN_METHOD(requestAuthorization, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(queryHKitSampleType,  CAPPluginReturnPromise);
)
