//
//  ViewController.swift
//  BackNine
//
//  David 2026-08-06: custom subclass of Capacitor's bridge view
//  controller that manually registers our in-app HealthKit plugin.
//
//  Why we need this: Capacitor 8 auto-discovers plugins from npm
//  packages via its generated Plugins.swift file, but plugins defined
//  inside the app target (like our HealthKitPlugin.swift) are invisible
//  to that discovery. Registering here via `registerPluginInstance`
//  wires it into the JS bridge so window.Capacitor.Plugins.CapacitorHealthkit
//  resolves at runtime.
//
//  To activate: in Xcode, open Main.storyboard, select the initial
//  view controller, and change its Custom Class from
//  CAPBridgeViewController to ViewController (this file).

import UIKit
import Capacitor

class ViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        NSLog("BACKNINE: ViewController.capacitorDidLoad() FIRED")
        NSLog("BACKNINE: bridge is \(bridge == nil ? "nil" : "present")")

        // Try both registration APIs to see which Cap 8 accepts
        if let bridge = self.bridge {
            let instance = HealthKitPlugin()
            NSLog("BACKNINE: instantiated HealthKitPlugin: \(instance)")
            bridge.registerPluginInstance(instance)
            NSLog("BACKNINE: registerPluginInstance called")
        } else {
            NSLog("BACKNINE: ERROR - bridge is nil, cannot register plugin")
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NSLog("BACKNINE: ViewController.viewDidLoad() FIRED — custom class is active")
    }
}
